#!/usr/bin/env node
require("@babel/register")({ presets: ["@babel/preset-env"] });
require("@babel/polyfill");
require("./analyze.js");
