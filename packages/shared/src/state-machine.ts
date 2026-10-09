// Lifecycles as data (after Vendure's FSM): states, events and allowed
// transitions are declared once; `transition()` is the single place where an
// illegal move is rejected. Effects are only named here. The calling service
// runs them inside its own transaction and writes the history row, which
// keeps this helper pure and unit-testable.
import { AppError } from './errors';

export interface TransitionDef<S extends string, C> {
  to: S;
  /** Return true to allow, or a reason string to refuse. */
  guard?: (context: C) => true | string;
  /** Names of side effects the caller must run, e.g. "release_stock". */
  effects?: readonly string[];
}

export interface MachineDef<S extends string, E extends string, C> {
  name: string;
  initial: S;
  states: readonly S[];
  transitions: { readonly [F in S]?: { readonly [Ev in E]?: TransitionDef<S, C> } };
}

export interface Transition<S extends string, E extends string> {
  machine: string;
  from: S;
  to: S;
  event: E;
  effects: readonly string[];
}

export interface Machine<S extends string, E extends string, C> {
  readonly name: string;
  readonly initial: S;
  readonly states: readonly S[];
  /** Events allowed from `from`, ignoring guards. */
  events(from: S): E[];
  isFinal(state: S): boolean;
  can(from: S, event: E, context: C): boolean;
  /** Returns the transition, or throws AppError('illegal_transition'). */
  transition(from: S, event: E, context: C): Transition<S, E>;
  /** A Mermaid state diagram, for docs. */
  toMermaid(): string;
}

export function defineMachine<const S extends string, const E extends string, C = void>(
  def: MachineDef<S, E, C>,
): Machine<S, E, C> {
  const known = new Set<string>(def.states);
  if (!known.has(def.initial)) {
    throw new Error(`${def.name}: initial state "${def.initial}" is not in states`);
  }
  for (const [from, events] of Object.entries(def.transitions) as [string, object][]) {
    if (!known.has(from)) throw new Error(`${def.name}: unknown state "${from}"`);
    for (const [event, t] of Object.entries(events) as [string, TransitionDef<S, C>][]) {
      if (!known.has(t.to)) {
        throw new Error(`${def.name}: "${from}" --${event}--> unknown state "${t.to}"`);
      }
    }
  }

  const lookup = (from: S, event: E) => def.transitions[from]?.[event];
  const illegal = (from: S, event: E, reason: string) =>
    new AppError('illegal_transition', {
      detail: `${def.name}: cannot ${event} from ${from}: ${reason}`,
    });

  return {
    name: def.name,
    initial: def.initial,
    states: def.states,
    events: (from) => Object.keys(def.transitions[from] ?? {}) as E[],
    isFinal: (state) => Object.keys(def.transitions[state] ?? {}).length === 0,
    can(from, event, context) {
      const t = lookup(from, event);
      return t !== undefined && (t.guard?.(context) ?? true) === true;
    },
    transition(from, event, context) {
      const t = lookup(from, event);
      if (!t) throw illegal(from, event, 'not an allowed transition');
      const verdict = t.guard?.(context) ?? true;
      if (verdict !== true) throw illegal(from, event, verdict);
      return { machine: def.name, from, to: t.to, event, effects: t.effects ?? [] };
    },
    toMermaid() {
      const lines = ['stateDiagram-v2', `  [*] --> ${def.initial}`];
      for (const from of def.states) {
        const events = def.transitions[from] ?? {};
        for (const [event, t] of Object.entries(events) as [string, TransitionDef<S, C>][]) {
          lines.push(`  ${from} --> ${t.to}: ${event}`);
        }
        if (Object.keys(events).length === 0) lines.push(`  ${from} --> [*]`);
      }
      return lines.join('\n');
    },
  };
}
