/* The sign-in gate's form: an email, a password, and one button that either
   signs in or registers.

   Same shape as the editors — it takes its root and its two actions as
   arguments, imports no app state and touches no global, so the whole form
   can be driven in node --test with a hand-rolled DOM. It knows nothing
   about Supabase; auth.js owns the requests and, deliberately, owns the
   wording of every refusal too (see CREDENTIALS_MESSAGE there). This module
   shows what it is handed. A form that composed its own explanation of a
   failed sign-in could undo, from here, the one thing that stops the gate
   being used to test whether an address has an account.

   Every string is set with textContent, never interpolated into innerHTML —
   a security control rather than a style, because a session token lives in
   localStorage.

   The typed password exists in exactly one place: the input's own value. It
   is passed to the action and never copied into an attribute, a message, or
   a field the page keeps. */

import { MIN_PASSWORD, passwordProblem } from './auth.js';

export function mountAuthForm({ root, onSignIn, onSignUp }) {
  /* Mounted at app.js's module scope, before anything is on screen: a throw
     for a missing root would take the page down before the gate is drawn. */
  if (!root) return;

  const doc = root.ownerDocument;
  const el = (tag, className) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  let registering = false;
  let busy = false;

  const form = el('form', 'auth-form');

  const emailInput = el('input', 'auth-input');
  emailInput.type = 'email';
  emailInput.value = '';
  emailInput.placeholder = 'you@example.com';
  emailInput.setAttribute('aria-label', 'Email');
  emailInput.setAttribute('autocomplete', 'email');
  emailInput.setAttribute('required', 'required');

  const passwordInput = el('input', 'auth-input');
  passwordInput.type = 'password';
  passwordInput.value = '';
  passwordInput.setAttribute('aria-label', 'Password');
  passwordInput.setAttribute('required', 'required');

  const submitBtn = el('button', 'auth-submit');
  submitBtn.type = 'submit';

  const toggleBtn = el('button', 'auth-toggle');
  toggleBtn.type = 'button';

  /* Two lines, not one. An error is about the attempt that just failed; the
     note is about what to do next ("check your inbox"), and it has to
     survive the mode switch that follows registration. Sharing one line
     would mean the confirmation instruction is wiped by the next keystroke's
     validation message. */
  const errorLine = el('p', 'auth-error');
  errorLine.setAttribute('role', 'alert');
  const noteLine = el('p', 'auth-note');

  function render() {
    submitBtn.textContent = registering ? 'Create account' : 'Sign in';
    toggleBtn.textContent = registering
      ? 'Already have an account? Sign in'
      : 'New here? Create an account';
    /* current-password lets a manager offer the saved one; new-password stops
       it offering that same saved password as though it were being
       re-entered, and prompts it to suggest and store a fresh one. */
    passwordInput.setAttribute('autocomplete', registering ? 'new-password' : 'current-password');
    passwordInput.placeholder = registering ? `At least ${MIN_PASSWORD} characters` : '';
  }

  const setBusy = (value) => {
    busy = value;
    submitBtn.disabled = value;
    submitBtn.textContent = value
      ? (registering ? 'Creating account…' : 'Signing in…')
      : (registering ? 'Create account' : 'Sign in');
  };

  async function attempt() {
    /* Two taps on a slow connection are two attempts, which is how a user
       walks themselves into the server's rate limiter. */
    if (busy) return;
    const email = String(emailInput.value || '').trim();
    const password = String(passwordInput.value || '');
    errorLine.textContent = '';

    if (!email) { errorLine.textContent = 'Enter your email'; return; }
    if (!password) { errorLine.textContent = 'Enter your password'; return; }
    /* Only when registering. An account made before this rule existed still
       has to be able to get in, and refusing to even ASK on the user's
       behalf would lock them out of their own data over a rule the server is
       the actual authority on. */
    if (registering) {
      const problem = passwordProblem(password);
      if (problem) { errorLine.textContent = problem; return; }
    }

    setBusy(true);
    noteLine.textContent = '';
    try {
      if (registering) {
        const { needsConfirmation } = (await onSignUp({ email, password })) || {};
        if (needsConfirmation) {
          /* The account exists but cannot read or write a row yet, so this
             is not a sign-in. Say where the link went, clear the password,
             and leave the form on the mode that will work next. */
          noteLine.textContent = `Account created. Confirm it from the link sent to ${email}, then sign in.`;
          passwordInput.value = '';
          registering = false;
          render();
        }
      } else {
        await onSignIn({ email, password });
      }
    } catch (err) {
      errorLine.textContent = err?.message || 'Something went wrong. Try again.';
    } finally {
      setBusy(false);
    }
  }

  /* Both, because a form submits on Enter and the button is also clicked. */
  form.addEventListener('submit', (ev) => { ev.preventDefault?.(); attempt(); });
  submitBtn.addEventListener('click', (ev) => { ev.preventDefault?.(); attempt(); });

  toggleBtn.addEventListener('click', () => {
    registering = !registering;
    errorLine.textContent = '';
    /* Cleared across the switch: a password typed for one purpose should not
       be silently submitted for the other. */
    passwordInput.value = '';
    render();
    passwordInput.focus?.();
  });

  form.append(emailInput, passwordInput, submitBtn);
  root.append(form, toggleBtn, errorLine, noteLine);
  render();

  return {
    /* app.js clears the gate's message when it re-renders the view. */
    reset() {
      errorLine.textContent = '';
      noteLine.textContent = '';
      passwordInput.value = '';
    },
    showError(message) { errorLine.textContent = String(message || ''); },
  };
}
