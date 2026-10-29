// Which map locs survivors mode removes from an arena. Shared by the build-time collision extractor
// and the runtime client scene build, so what you see is exactly what the simulation paths over.
// Doors, gates, ladders, stairs and trapdoors are removed (they imply exits or would block a
// building forever). Everything else stays as scenery; with every click being "walk here", other
// interactive objects are neutralised automatically.

type LocLike = { name: string | null; op: (string | null)[] | null };

const REMOVE_OPS = /^(open|close|climb|climb-up|climb-down|climb-over|go-through|walk-through|squeeze-through|pass|enter|pick-lock|knock-at|jump-over|jump|cross|walk-down|walk-up)$/i;
const REMOVE_NAMES = /\b(door|doors|gate|ladder|staircase|stairs|trapdoor|manhole)\b/i;

export function shouldRemoveLoc(loc: LocLike, _shape: number): boolean {
    const name = loc.name ?? '';
    const ops = loc.op ?? [];
    let interactive = false;
    for (const op of ops) {
        if (op && REMOVE_OPS.test(op.trim())) {
            interactive = true;
            break;
        }
    }
    if (interactive && (REMOVE_NAMES.test(name) || /door|gate/i.test(name) || ops.some(o => o && /^(open|close|climb)/i.test(o)))) {
        return true;
    }
    return REMOVE_NAMES.test(name) && ops.some(o => o !== null && o !== 'Examine');
}
