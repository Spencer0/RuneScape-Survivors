// Survivors: the shared client cycle counter. Originally a static on Client; entity/loc animation
// code only needs the counter, so it lives here to keep those modules free of the full Client
// (which drags in browser-only audio/login code and breaks headless use in Node).
export const Cycle = {
    loop: 0,
    draw: 0
};
