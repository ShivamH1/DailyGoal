import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv, URL_KEYS, KEY_KEYS } from '../tools/make-config.mjs';

/* parseEnv used to live in an un-imported build script, which is how it went
   a whole project without anyone noticing it mangled a quoted value. */

test('a plain KEY=value line', () => {
  assert.deepEqual(parseEnv('USER_ID=abc123'), { USER_ID: 'abc123' });
});

test('a double-quoted value loses its quotes', () => {
  assert.deepEqual(parseEnv('PUBLIC_KEY="abc123"'), { PUBLIC_KEY: 'abc123' });
});

test('a single-quoted value loses its quotes', () => {
  assert.deepEqual(parseEnv("PUBLIC_KEY='abc123'"), { PUBLIC_KEY: 'abc123' });
});

test('a quoted value with a trailing semicolon keeps neither', () => {
  /* The shape this project's own generated config.js has, and the shape the
     user's .env was pasted into. The old regex stripped one character from
     each end, so the closing quote survived and the value came back as
     'https://x.supabase.co";' — a URL that cannot resolve. */
  assert.deepEqual(
    parseEnv('SUPABASE_URL ="https://x.supabase.co";'),
    { SUPABASE_URL: 'https://x.supabase.co' }
  );
});

test('the same malformed shape with single quotes', () => {
  assert.deepEqual(parseEnv("USER_ID ='abc-123';"), { USER_ID: 'abc-123' });
});

test('an unquoted value gives up one trailing semicolon', () => {
  /* A bare ';' is never part of a Supabase URL, an anon key or a UUID. */
  assert.deepEqual(parseEnv('USER_ID=abc123;'), { USER_ID: 'abc123' });
  assert.deepEqual(parseEnv('USER_ID=abc123 ;'), { USER_ID: 'abc123' });
});

test('spaces around the = are trimmed from both sides', () => {
  assert.deepEqual(parseEnv('  SUPABASE_URL   =   https://x.co  '), { SUPABASE_URL: 'https://x.co' });
});

test('a comment line is ignored', () => {
  assert.deepEqual(parseEnv('# PUBLIC_KEY=secret\nUSER_ID=u1'), { USER_ID: 'u1' });
});

test('blank lines and lines without an = are ignored', () => {
  assert.deepEqual(parseEnv('\n   \nnot a pair\nUSER_ID=u1\n\n'), { USER_ID: 'u1' });
});

test('a value containing = survives intact', () => {
  /* Split on the FIRST '=' only: a query string is a legitimate value, and
     an anon key is base64 that can end in '='. */
  assert.deepEqual(
    parseEnv('PROJECT_URL=https://x.co/rest?select=*&user_id=eq.7'),
    { PROJECT_URL: 'https://x.co/rest?select=*&user_id=eq.7' }
  );
  assert.deepEqual(parseEnv('PUBLIC_KEY="ab=cd=="'), { PUBLIC_KEY: 'ab=cd==' });
});

test('an unterminated quote keeps the rest rather than dropping the line', () => {
  assert.deepEqual(parseEnv('USER_ID="abc123'), { USER_ID: 'abc123' });
});

test('a whole file parses into every pair it declares', () => {
  const file = [
    '# Supabase',
    'PROJECT_URL ="https://x.supabase.co";',
    '',
    "PUBLIC_KEY = 'anon-key-value';",
    'USER_ID=11111111-2222-3333-4444-555555555555',
    '# SECRET_KEY=must-not-be-read',
  ].join('\n');
  assert.deepEqual(parseEnv(file), {
    PROJECT_URL: 'https://x.supabase.co',
    PUBLIC_KEY: 'anon-key-value',
    USER_ID: '11111111-2222-3333-4444-555555555555',
  });
});

test('both accepted spellings are declared, dashboard name first', () => {
  assert.deepEqual(URL_KEYS, ['PROJECT_URL', 'SUPABASE_URL']);
  assert.deepEqual(KEY_KEYS, ['PUBLIC_KEY', 'SUPABASE_ANON_KEY']);
});

test('the generator no longer emits USER_ID', async () => {
  /* Rows are keyed to auth.uid() now. A generated USER_ID would be a value
     nothing reads, which is how stale configuration outlives its meaning. */
  const src = await import('node:fs').then((fs) => fs.readFileSync('tools/make-config.mjs', 'utf8'));
  assert.doesNotMatch(src, /export const USER_ID/);
});
