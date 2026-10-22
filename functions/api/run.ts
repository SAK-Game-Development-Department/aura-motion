// GET /api/run?stage=<id> → a signed, single-use play token (see src/exhibit/runToken.ts).
import { STAGES } from '../../src/battle/stages';
import { newNonce, signRun } from '../../src/exhibit/runToken';

interface Env {
  RUN_SECRET?: string;
}

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.RUN_SECRET) return json({ error: 'ranking disabled' }, 503);
  const stage = new URL(request.url).searchParams.get('stage') ?? '';
  if (!(stage in STAGES)) return json({ error: 'stage' }, 400);
  const token = await signRun(env.RUN_SECRET, { nonce: newNonce(), at: Date.now(), stage });
  return json({ token });
};

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
