import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mountAuthForm } from '../authForm.js';
import { MIN_PASSWORD } from '../auth.js';

/* Same approach as the other editor tests: authForm.js takes its root as a
   parameter and touches nothing global, so a hand-rolled stand-in with just
   the vocabulary it uses is enough to drive the whole form with no browser. */
function makeDoc() {
  function createElement(tag) {
    const el = {
      tagName: tag.toUpperCase(),
      children: [],
      parentNode: null,
      className: '',
      type: '',
      value: '',
      placeholder: '',
      hidden: false,
      disabled: false,
      _text: '',
      listeners: {},
      attrs: {},
      setAttribute(name, v) { el.attrs[name] = String(v); },
      getAttribute(name) { return Object.prototype.hasOwnProperty.call(el.attrs, name) ? el.attrs[name] : null; },
      get textContent() {
        return el.children.length ? el.children.map((c) => c.textContent).join('') : el._text;
      },
      set textContent(v) { el._text = String(v); el.children = []; },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      append(...items) { for (const i of items) el.appendChild(i); },
      remove() { if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el); },
      addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
      dispatch(type) {
        const ev = { target: el, preventDefault() { ev.defaulted = true; } };
        (el.listeners[type] || []).forEach((fn) => fn(ev));
        return ev;
      },
      focus() { el.focused = true; },
    };
    return el;
  }
  return { createElement };
}

function makeRoot() {
  const doc = makeDoc();
  const root = doc.createElement('div');
  root.ownerDocument = doc;
  return root;
}

const collect = (el, out = []) => { out.push(el); for (const c of el.children) collect(c, out); return out; };
const findAll = (root, pred) => collect(root).filter(pred);
const field = (root, label) => findAll(root, (el) => el.getAttribute('aria-label') === label)[0];
const submit = (root) => findAll(root, (el) => el.className === 'auth-submit')[0];
const toggle = (root) => findAll(root, (el) => el.className === 'auth-toggle')[0];
const errorLine = (root) => findAll(root, (el) => el.className === 'auth-error')[0];
const noteLine = (root) => findAll(root, (el) => el.className === 'auth-note')[0];

/* The form's submit handler is async; every test that submits awaits this so
   it reads the DOM after the handler has settled rather than racing it. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const mount = (over = {}) => {
  const root = makeRoot();
  const calls = { in: [], up: [] };
  mountAuthForm({
    root,
    onSignIn: over.onSignIn || (async (c) => { calls.in.push(c); }),
    onSignUp: over.onSignUp || (async (c) => { calls.up.push(c); return { needsConfirmation: false }; }),
  });
  return { root, calls };
};

test('the form asks for an email and a password, and hides the password', () => {
  const { root } = mount();
  const email = field(root, 'Email');
  const password = field(root, 'Password');
  assert.ok(email && password, 'both fields are rendered');
  assert.equal(password.type, 'password', 'a typed password is never on screen');
  assert.equal(email.type, 'email');
  /* Told to the password manager, so the browser offers the right thing and
     does not save a new password over an existing one. */
  assert.equal(password.getAttribute('autocomplete'), 'current-password');
  assert.equal(email.getAttribute('autocomplete'), 'email');
});

test('signing in hands over the typed credentials, with the email trimmed', async () => {
  const { root, calls } = mount();
  field(root, 'Email').value = '  me@test  ';
  field(root, 'Password').value = 'correct horse';
  submit(root).dispatch('click');
  await settle();
  assert.deepEqual(calls.in, [{ email: 'me@test', password: 'correct horse' }]);
  assert.deepEqual(calls.up, [], 'and not to the registration route');
});

test('the toggle switches the form to registration, and tells the browser so', () => {
  const { root } = mount();
  assert.match(submit(root).textContent, /sign in/i);
  toggle(root).dispatch('click');
  assert.match(submit(root).textContent, /create/i);
  /* new-password, or a password manager offers the one already saved for
     this site as though it were being re-entered. */
  assert.equal(field(root, 'Password').getAttribute('autocomplete'), 'new-password');
  toggle(root).dispatch('click');
  assert.match(submit(root).textContent, /sign in/i);
});

test('registering with a short password never reaches the network', async () => {
  const { root, calls } = mount();
  toggle(root).dispatch('click');
  field(root, 'Email').value = 'new@test';
  field(root, 'Password').value = 'x'.repeat(MIN_PASSWORD - 1);
  submit(root).dispatch('click');
  await settle();
  assert.deepEqual(calls.up, [], 'nothing was sent');
  assert.match(errorLine(root).textContent, new RegExp(`${MIN_PASSWORD} characters`));
});

test('the length rule is not applied to signing IN', async () => {
  /* An account made before the rule existed still has to be able to get in.
     The server is the authority on whether a password is right; refusing to
     ASK on the user's behalf just locks them out of their own data. */
  const { root, calls } = mount();
  field(root, 'Email').value = 'me@test';
  field(root, 'Password').value = 'old';
  submit(root).dispatch('click');
  await settle();
  assert.equal(calls.in.length, 1);
});

test('an empty email is refused before anything is sent', async () => {
  const { root, calls } = mount();
  field(root, 'Password').value = 'correct horse';
  submit(root).dispatch('click');
  await settle();
  assert.deepEqual(calls.in, []);
  assert.match(errorLine(root).textContent, /email/i);
});

test('a refusal is shown exactly as auth.js worded it', async () => {
  /* The form does not compose its own explanation of a failed sign-in.
     auth.js deliberately says one thing for every refusal so the form cannot
     be used to test whether an address is registered, and a form that
     rewrote the message could undo that from here. */
  const { root } = mount({ onSignIn: async () => { throw new Error('Email or password is incorrect'); } });
  field(root, 'Email').value = 'me@test';
  field(root, 'Password').value = 'wrong password';
  submit(root).dispatch('click');
  await settle();
  assert.equal(errorLine(root).textContent, 'Email or password is incorrect');
  assert.equal(submit(root).disabled, false, 'and the form is usable again');
});

test('the submit control is locked while the request is in flight', async () => {
  /* Two taps on a slow connection are two sign-in attempts, which is how a
     user walks themselves into the rate limiter. */
  let release = null;
  const { root, calls } = mount({ onSignIn: (c) => new Promise((resolve) => { calls.in.push(c); release = resolve; }) });
  field(root, 'Email').value = 'me@test';
  field(root, 'Password').value = 'correct horse';
  submit(root).dispatch('click');
  await settle();
  assert.equal(submit(root).disabled, true, 'locked during the attempt');
  submit(root).dispatch('click');
  await settle();
  assert.equal(calls.in.length, 1, 'a second tap does nothing');
  release();
  await settle();
  assert.equal(submit(root).disabled, false, 'and unlocked afterwards');
});

test('an account awaiting confirmation is told to check its inbox, not signed in', async () => {
  const { root } = mount({ onSignUp: async () => ({ needsConfirmation: true }) });
  toggle(root).dispatch('click');
  field(root, 'Email').value = 'new@test';
  field(root, 'Password').value = 'x'.repeat(MIN_PASSWORD);
  submit(root).dispatch('click');
  await settle();
  assert.match(noteLine(root).textContent, /new@test/, 'the address it was sent to');
  assert.match(noteLine(root).textContent, /confirm/i);
  /* Back to sign-in, because that is the next thing that will work. */
  assert.match(submit(root).textContent, /sign in/i);
  assert.equal(field(root, 'Password').value, '', 'and the password is not left sitting in the field');
});

test('the password is never written into the page', async () => {
  /* It lives in the input's value and nowhere else: not in an attribute, not
     in an error message, not in a note. */
  const PASSWORD = 'correct horse battery';
  const { root } = mount({ onSignIn: async () => { throw new Error('Email or password is incorrect'); } });
  field(root, 'Email').value = 'me@test';
  field(root, 'Password').value = PASSWORD;
  submit(root).dispatch('click');
  await settle();
  for (const el of collect(root)) {
    if (el !== field(root, 'Password')) assert.doesNotMatch(el.value || '', /correct horse/);
    assert.doesNotMatch(el._text || '', /correct horse/);
    assert.doesNotMatch(JSON.stringify(el.attrs), /correct horse/);
  }
});
