/** Where a signed-in user lands by default. */
export const homeFor = (user) => (user?.role === 'ADMIN' ? '/admin' : '/dashboard')
