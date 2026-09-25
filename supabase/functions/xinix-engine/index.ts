// xinix-engine — de explosie-motor. Eén functie met twee taken, zodat de
// gedeelde rekenkern maar één keer gedeployed hoeft te worden:
//   POST /xinix-engine/deep      deep-scan (elke 20 min, zie deep.ts)
//   POST /xinix-engine/universe  dagelijkse sweep + scoren (22:40 UTC, zie universe.ts)
import { runBackground } from "../_shared/universe.ts";
import { deepScan } from "./deep.ts";
import { universeRun } from "./universe.ts";

const deep = runBackground("xinix-deep-scan", deepScan);
const universe = runBackground("xinix-universe", universeRun);

Deno.serve((req) => (new URL(req.url).pathname.endsWith("/universe") ? universe(req) : deep(req)));
