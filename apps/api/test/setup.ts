if (!process.env.ENCRYPTION_KEY_BASE64) {
  process.env.ENCRYPTION_KEY_BASE64 = Buffer.alloc(32, 9).toString('base64');
}
if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = 'unit-test-session-secret';
}
