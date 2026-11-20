// Pure decision rule. A trigger is { field, op: ">" | "<", threshold, tolerance }.
// tolerance is the largest relative gap allowed between the two miners (0.02 = 2%).
// abs_tolerance, if set, replaces it with an absolute gap (for values near zero, such as temperatures).
// always: true buys the second answer every time, so a wrong first answer cannot hide a breach (costs two answers per check).
// a and b are the two miners' result objects; without always, b is only bought after a breaches.

const num = (r, field) => {
  const v = Number(r?.[field]);
  return r?.[field] != null && Number.isFinite(v) ? v : null;
};
const breached = (v, t) => (t.op === "<" ? v < t.threshold : v > t.threshold);

export function needsSecond(trigger, a) {
  const va = num(a, trigger.field);
  return va !== null && (trigger.always === true || breached(va, trigger));
}

export function decide(trigger, a, b) {
  const va = num(a, trigger.field);
  if (va === null) return { decision: "NO_DATA", reason: `first miner returned no ${trigger.field}` };
  const vb = num(b, trigger.field);
  if (!breached(va, trigger) && !trigger.always) return { decision: "NO_PAY", reason: `${va} is not ${trigger.op} ${trigger.threshold}`, values: [va] };
  if (vb === null) return { decision: "DISPUTED", reason: "not corroborated: no second answer", values: [va] };
  const abs = trigger.abs_tolerance != null;
  const gap = abs ? Math.abs(va - vb) : Math.abs(va - vb) / Math.max(Math.abs(va), Math.abs(vb), Number.EPSILON);
  if (gap > (abs ? trigger.abs_tolerance : trigger.tolerance))
    return {
      decision: "DISPUTED",
      reason: abs
        ? `miners differ by ${+gap.toFixed(4)}, limit ${trigger.abs_tolerance}`
        : `miners differ by ${(gap * 100).toFixed(2)}%, limit ${trigger.tolerance * 100}%`,
      values: [va, vb],
    };
  if (!breached(va, trigger) && !breached(vb, trigger)) return { decision: "NO_PAY", reason: `both miners report ${trigger.field} not ${trigger.op} ${trigger.threshold}`, values: [va, vb] };
  if (!breached(va, trigger) || !breached(vb, trigger)) return { decision: "DISPUTED", reason: `miners fall on opposite sides of the threshold (${va}, ${vb})`, values: [va, vb] };
  return { decision: "PAY", reason: `both miners report ${trigger.field} ${trigger.op} ${trigger.threshold}`, values: [va, vb] };
}
