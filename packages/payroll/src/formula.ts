import { money, type Money } from '@hr/shared/money';

/**
 * Safe arithmetic for formula pay components (PLAN.md Phase 7: never `eval`). Grammar:
 *
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := '-' unary | atom
 *   atom   := NUMBER | IDENT | FUNC '(' expr (',' expr)* ')' | '(' expr ')'
 *
 * Identifiers must be in the variables map (upper-case codes such as BASIC, WORKING_DAYS).
 * Functions: min, max. All arithmetic is decimal (no floating point).
 */
export class FormulaError extends Error {}

type Token =
  | { t: 'num'; v: string }
  | { t: 'id'; v: string }
  | { t: 'op'; v: '+' | '-' | '*' | '/' | '(' | ')' | ',' };

const MAX_LENGTH = 500; // structural-constant: input size limit, not a rate

function tokenize(src: string): Token[] {
  if (src.length > MAX_LENGTH) throw new FormulaError('Formula is too long');
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d+(\.\d+)?|^\.\d+/.exec(src.slice(i));
      if (!m) throw new FormulaError(`Bad number at position ${i + 1}`);
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/(),'.includes(c)) {
      out.push({ t: 'op', v: c as '+' });
      i++;
    } else {
      throw new FormulaError(`Unexpected "${c}" at position ${i + 1}`);
    }
  }
  return out;
}

const FUNCS: Record<string, (args: Money[]) => Money> = {
  min: (a) => a.reduce((x, y) => (y.lessThan(x) ? y : x)),
  max: (a) => a.reduce((x, y) => (y.greaterThan(x) ? y : x)),
};

export function evaluateFormula(src: string, vars: Readonly<Record<string, Money>>): Money {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => {
    const tk = peek();
    return tk?.t === 'op' && tk.v === v;
  };
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`Expected "${v}"`);
    p++;
  };

  function expr(): Money {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = (tokens[p++] as { v: string }).v;
      const right = term();
      left = op === '+' ? left.plus(right) : left.minus(right);
    }
    return left;
  }
  function term(): Money {
    let left = unary();
    while (isOp('*') || isOp('/')) {
      const op = (tokens[p++] as { v: string }).v;
      const right = unary();
      if (op === '/' && right.isZero()) throw new FormulaError('Division by zero');
      left = op === '*' ? left.times(right) : left.dividedBy(right);
    }
    return left;
  }
  function unary(): Money {
    if (isOp('-')) {
      p++;
      return unary().negated();
    }
    return atom();
  }
  function atom(): Money {
    const tk = tokens[p++];
    if (!tk) throw new FormulaError('Unexpected end of formula');
    if (tk.t === 'num') return money(tk.v);
    if (tk.t === 'id') {
      const fn = Object.hasOwn(FUNCS, tk.v.toLowerCase()) ? FUNCS[tk.v.toLowerCase()] : undefined;
      if (fn && isOp('(')) {
        p++;
        const args = [expr()];
        while (isOp(',')) {
          p++;
          args.push(expr());
        }
        expect(')');
        return fn(args);
      }
      // Own properties only: `constructor`, `__proto__` etc. must never resolve.
      if (!Object.hasOwn(vars, tk.v)) throw new FormulaError(`Unknown variable ${tk.v}`);
      return vars[tk.v]!;
    }
    if (tk.v === '(') {
      const v = expr();
      expect(')');
      return v;
    }
    throw new FormulaError(`Unexpected "${tk.v}"`);
  }

  const result = expr();
  if (p !== tokens.length) throw new FormulaError('Unexpected text after the formula');
  return result;
}

/** Variables a formula references (for validation when HR saves a component). */
export function formulaVariables(src: string): string[] {
  return [
    ...new Set(
      tokenize(src)
        .filter(
          (t): t is { t: 'id'; v: string } =>
            t.t === 'id' && !Object.hasOwn(FUNCS, t.v.toLowerCase()),
        )
        .map((t) => t.v),
    ),
  ];
}
