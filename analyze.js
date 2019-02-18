import { readdir, readFile, writeFile } from "fs";
import { promisify } from "util";
import { join } from "path";
import Commander from "commander";

const path = join(
  process.cwd(),
  "node_modules",
  "fastlane-git",
  "fastlane",
  "swift"
);
Commander.option(
  "-o --output <file>",
  "File to write results to (leave blank for standard output"
);
Commander.parse(process.argv);

const start = async () => {
  const funcs = await getFunctions(join(path, "Fastlane.swift"));
  const funcinfo = funcs
    .map(analyzeFunction)
    .filter(f => f)
    .reduce(
      (o, { methodName, rubyArguments }) => ({
        ...o,
        [methodName]: rubyArguments
      }),
      {}
    );
  if (Commander.output) {
    await promisify(writeFile)(Commander.output, JSON.stringify(funcinfo));
  } else {
    console.log(JSON.stringify(funcinfo, null, 2));
  }
};
const getType = (type, defaultValue = null) => {
  let isNullable = false;
  if (type.endsWith("?")) {
    isNullable = true;
    type = type.substring(0, type.length - 1);
  }

  switch (type) {
    case "Bool":
      defaultValue = defaultValue === "true";
      type = "boolean";
      break;
    case "Int":
      type = "number";
    case "String":
      type = "string";
  }
  if (type.startsWith("[")) {
    if (type.includes(":")) {
      //   const [keyType, valueType] = type.split(":", 2);
      type = "object";
      if (defaultValue == "[:]") defaultValue = {};
      //object
    } else {
      //array
      //extract the type
      const { type: baseType } = getType(type.replace(/[\[\]]/g, ""));
      type = baseType + "[]";
      if (defaultValue == "[]") defaultValue = [];
    }
  }
  return { type, defaultValue, isNullable };
};
const analyzeFunction = a => {
  const funcs = a[0].match(/func (.*)\(/);
  const name = funcs && funcs[1];
  //get index of the open bracket
  const bracketlineIndex = a.findIndex(s => s.includes("{"));
  const arglines = a.slice(0, bracketlineIndex + 1);
  const bodylines = a.slice(bracketlineIndex + 1, a.length);
  if (!bodylines || !bodylines.length) return null;
  const hasRubyCommand = bodylines.find(s => {
    if (!s) return false;
    const temp = s.includes("RubyCommand(");
    return temp && temp.length > 0;
  });
  const arginfo = arglines.reduce(
    (o, line) => {
      //trim the line
      if (line.includes("(")) line = line.substring(line.indexOf("(") + 1);
      if (line.includes(")")) line = line.substring(0, line.indexOf(")"));
      if (line.endsWith(",")) line = line.substring(0, line.length - 1);
      let [assignment, rawdefaultValue] = line.split("=").map(s => s.trim());

      let [k, ...typePieces] = assignment.split(":").map(s => s.trim());
      let { type, defaultValue, isNullable } = getType(
        typePieces.join(":"),
        rawdefaultValue
      );

      if (defaultValue == "nil") defaultValue = undefined;
      return {
        ...o,
        [k]: {
          type,
          ...(typeof defaultValue === "undefined" ? {} : { defaultValue }),
          isNullable
        }
      };
      //check first line for the func name
      return o;
    },
    { hasRubyCommand, name }
  );
  //let's find the rubyInfo
  const { rubyLines } = bodylines.reduce(
    (o, line) => {
      if (!o.rubyLines.length && line.includes("RubyCommand(")) {
        o.rubyLines.push(line);
        //get left parens
        const lefts = line.match(/\(/g).length;
        o.lefts = lefts;
        const rights = line.match(/\)/g).length;
        return { rubyLines: [line], lefts, rights };
      } else if (o.rubyLines.length && o.lefts > o.rights) {
        const lefts = line.match(/\(/g).length;
        o.lefts += lefts;
        const rights = line.match(/\)/g).length;
        o.rights += rights;
        o.rubyLines = [...o.rubyLines, line];
        return o;
      } else {
        return o;
      }
    },
    { rubyLines: [] }
  );
  if (!rubyLines || !rubyLines.length) return null;
  const rubyLine = rubyLines.map(s => s.trim()).join(" ");
  const argLine = rubyLine
    .substring(0, rubyLine.length - 1)
    .substring(rubyLine.indexOf("(") + 1);
  let [basicCommandString, argString] = argLine.split("args:");
  let basicCommands = basicCommandString.split(",").reduce((o, s) => {
    let [k, v] = s.split(":").map(s => s.trim());
    if (v === "nil") return o;
    if (v && v.length) v = v.replace(/"/g, "");
    if (k.length) return { ...o, [k]: v };
    else return o;
  }, {});
  argString = argString.trim();
  if (argString.startsWith("[")) argString = argString.substring(1);
  let commands = argString
    .split("RubyCommand.Argument")
    .map(s => s.trim())
    .map(s => s.substring(1, s.length - 2));
  let rubyCommands = commands.reduce((o, s) => {
    let { name, value } = s
      .split(",", 2)
      .map(s => s.trim())
      .reduce((o, s) => {
        let [name, value] = s.split(":").map(s => s.trim());
        if (typeof value === "undefined") return o;
        return { ...o, [name]: value };
      }, {});
    if (name) name = name.replace(/"/g, "");
    return name ? { ...o, [name]: value } : o;
  }, {});
  const rubyArguments = Object.entries(rubyCommands).reduce((o, [k, v]) => {
    if (arginfo[v]) {
      return { ...o, [k]: arginfo[v] };
    } else {
      return { ...o, [k]: v };
    }
  }, {});
  if (!basicCommands.commandID) delete basicCommands.commandID;
  return { ...basicCommands, rubyArguments };
};
const getFunctions = async fp => {
  const text = await promisify(readFile)(fp, { encoding: "UTF8" });
  return text
    .split("\n")
    .filter(s => !s.trim().startsWith("//"))
    .filter(s => s.trim().length)
    .reduce((o, s) => {
      if (s.includes("func")) {
        return [...o, [s]];
      } else if (o.length) {
        let last = o.pop();
        last.push(s);
        return [...o, last];
      } else return o;
    }, []);
};
start();
