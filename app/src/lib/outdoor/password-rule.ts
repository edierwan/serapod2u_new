export function outdoorPasswordIssue(password: string) {
  if (password.length < 8) return 'Use at least 8 characters.'
  if (!/[a-z]/.test(password)) return 'Add a lowercase letter.'
  if (!/[A-Z]/.test(password)) return 'Add an uppercase letter.'
  if (!/[0-9]/.test(password)) return 'Add a number.'
  return ''
}
