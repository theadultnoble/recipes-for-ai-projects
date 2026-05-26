import bs58 from "bs58";
import fs from "fs";

const base58Key =
  "HN55vtQmDmpg4iM1922GgmJpq4A1fcjR9RH2oDEcazZt97MWUEQ2JjMC16KY2wee6PgyioiBBdmGrRhtwNzwNDE";

const decoded = bs58.decode(base58Key);

fs.writeFileSync("keypair.json", JSON.stringify(Array.from(decoded)));
