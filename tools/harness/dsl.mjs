// Tiny safe query DSL for scenario assertions (docs/TESTING.md section 3). No eval: a tokenizer, a
// recursive-descent parser to an AST, and an evaluator that only reads properties of objects the
// harness built (own properties, never prototypes) and calls functions the harness provided.
//
// Grammar: or := and ('||' and)* ; and := cmp ('&&' cmp)* ; cmp := add (cmpop add)? ;
// add := mul (('+'|'-') mul)* ; mul := unary (('*'|'/') unary)* ; unary := ('!'|'-') unary | post ;
// post := primary ('.' ident | '(' args ')')* ; primary := number | string | ident | '[' args ']' | '(' or ')'

const TOKEN = /\s*(?:(\d+(?:\.\d+)?)|('[^']*'|"[^"]*")|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[<>!+\-*/().,[\]]))/y;

export function tokenize(src) {
  const out = [];
  TOKEN.lastIndex = 0;
  let pos = 0;
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`unexpected character at ${pos}: "${src.slice(pos, pos + 10)}"`);
    if (m[1] !== undefined) out.push({ t: "num", v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ t: "str", v: m[2].slice(1, -1) });
    else if (m[3] !== undefined) out.push({ t: "id", v: m[3] });
    else out.push({ t: "op", v: m[4] });
    pos = TOKEN.lastIndex;
  }
  return out;
}

export function parse(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v) => toks[i] && toks[i].t === "op" && toks[i].v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new Error(`expected "${v}" at token ${i} in: ${src}`);
    i++;
  };
  const args = (close) => {
    const list = [];
    if (isOp(close)) {
      i++;
      return list;
    }
    for (;;) {
      list.push(or());
      if (isOp(",")) i++;
      else break;
    }
    expect(close);
    return list;
  };
  const primary = () => {
    const tk = peek();
    if (!tk) throw new Error(`unexpected end of: ${src}`);
    i++;
    if (tk.t === "num" || tk.t === "str") return { k: "lit", v: tk.v };
    if (tk.t === "id") return tk.v === "true" || tk.v === "false" ? { k: "lit", v: tk.v === "true" } : { k: "id", name: tk.v };
    if (tk.v === "[") return { k: "arr", items: args("]") };
    if (tk.v === "(") {
      const e = or();
      expect(")");
      return e;
    }
    throw new Error(`unexpected "${tk.v}" in: ${src}`);
  };
  const post = () => {
    let e = primary();
    for (;;) {
      if (isOp(".")) {
        i++;
        const tk = peek();
        if (!tk || tk.t !== "id") throw new Error(`expected a name after "." in: ${src}`);
        i++;
        e = { k: "get", obj: e, name: tk.v };
      } else if (isOp("(")) {
        i++;
        e = { k: "call", fn: e, args: args(")") };
      } else return e;
    }
  };
  const unary = () => {
    if (isOp("!") || isOp("-")) {
      const op = toks[i++].v;
      return { k: "un", op, e: unary() };
    }
    return post();
  };
  const bin = (next, ops) => () => {
    let l = next();
    while (toks[i] && toks[i].t === "op" && ops.includes(toks[i].v)) {
      const op = toks[i++].v;
      l = { k: "bin", op, l, r: next() };
    }
    return l;
  };
  const mul = bin(unary, ["*", "/"]);
  const add = bin(mul, ["+", "-"]);
  const cmp = () => {
    const l = add();
    if (toks[i] && toks[i].t === "op" && ["==", "!=", "<", "<=", ">", ">="].includes(toks[i].v)) {
      const op = toks[i++].v;
      return { k: "cmp", op, l, r: add() };
    }
    return l;
  };
  const and = bin(cmp, ["&&"]);
  const or = bin(and, ["||"]);
  const ast = or();
  if (i !== toks.length) throw new Error(`trailing tokens in: ${src}`);
  return ast;
}

function own(obj, name) {
  if (obj === null || (typeof obj !== "object" && typeof obj !== "function")) throw new Error(`cannot read "${name}" of ${String(obj)}`);
  if (!Object.prototype.hasOwnProperty.call(obj, name)) throw new Error(`unknown name "${name}"`);
  return obj[name];
}

/** Evaluate an AST. Returns the value; comparisons record their operands in `trace`. */
export function evaluate(ast, ctx, trace = []) {
  const ev = (n) => {
    switch (n.k) {
      case "lit":
        return n.v;
      case "id":
        return own(ctx, n.name);
      case "arr":
        return n.items.map(ev);
      case "get":
        return own(ev(n.obj), n.name);
      case "call": {
        const f = ev(n.fn);
        if (typeof f !== "function") throw new Error("not a function");
        return f(...n.args.map(ev));
      }
      case "un": {
        const v = ev(n.e);
        return n.op === "!" ? !v : -v;
      }
      case "bin": {
        if (n.op === "&&") return ev(n.l) && ev(n.r);
        if (n.op === "||") return ev(n.l) || ev(n.r);
        const a = ev(n.l);
        const b = ev(n.r);
        return n.op === "+" ? a + b : n.op === "-" ? a - b : n.op === "*" ? a * b : a / b;
      }
      case "cmp": {
        const a = ev(n.l);
        const b = ev(n.r);
        trace.push([a, n.op, b]);
        switch (n.op) {
          case "==":
            return a === b;
          case "!=":
            return a !== b;
          case "<":
            return a < b;
          case "<=":
            return a <= b;
          case ">":
            return a > b;
          default:
            return a >= b;
        }
      }
    }
    throw new Error(`bad node ${n.k}`);
  };
  return ev(ast);
}
