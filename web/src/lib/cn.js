/** Une clases condicionales: cn('a', cond && 'b') */
export const cn = (...xs) => xs.filter(Boolean).join(' ')
