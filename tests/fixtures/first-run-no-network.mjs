import dgram from "node:dgram";
import dns from "node:dns";
import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

function refuseNetwork() {
  process.on("exit", () => {
    process.exitCode = 91;
  });
  throw new Error("First run attempted networking");
}

net.Socket.prototype.connect = refuseNetwork;
dgram.Socket.prototype.send = refuseNetwork;
dns.lookup = refuseNetwork;
dns.resolve = refuseNetwork;
dns.promises.lookup = refuseNetwork;
dns.promises.resolve = refuseNetwork;
syncBuiltinESMExports();
