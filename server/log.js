// Log de consola con hora local (compartido por todos los módulos).
export const log = (...a) => console.log(new Date().toLocaleTimeString('es'), ...a)
