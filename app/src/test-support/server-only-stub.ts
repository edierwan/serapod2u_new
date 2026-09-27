// Test-only stand-in for the `server-only` marker package. The real package
// throws outside a React Server Components build; unit tests run server
// modules directly in Node, which is the environment the marker protects.
export {}
