import { main } from "./main.js";

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  console.error(`avocetta: ${(err as Error).message}`);
  process.exitCode = 2;
}
