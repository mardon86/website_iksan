const fs = require("fs");
const path = require("path");

module.exports = function () {
  const dir = path.join(__dirname, "produk-data");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
};
