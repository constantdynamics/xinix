// xinix-engine — de explosie-motor. Eén functie met twee taken, zodat de
// gedeelde rekenkern maar één keer gedeployed hoeft te worden:
//   POST /xinix-engine/deep      deep-scan (elke 20 min, zie deep.ts)
//   POST /xinix-engine/universe  dagelijkse sweep + scoren (22:40 UTC, zie universe.ts)
import { runBackground } from "../_shared/universe.ts";
import { deepScan } from "./deep.ts";
import { universeRun } from "./universe.ts";

const deep = runBackground("xinix-deep-scan", deepScan);
// Het deel zit in de query (?part=0..4 of ?part=finish): runBackground kent
// geen request-parameters, dus per aanroep een eigen handler.
const universe = (req: Request) => runBackground("xinix-universe", () => universeRun(new URL(req.url).searchParams.get("part")))(req);

Deno.serve((req) => (new URL(req.url).pathname.endsWith("/universe") ? universe(req) : deep(req)));
