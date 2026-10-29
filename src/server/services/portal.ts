import "server-only";
import { asDriver } from "@/lib/db";
import type { DriverPrincipal } from "../context";
import { convocationsOfDriver } from "./convocations";
import { driverVideosOf } from "./videos";

/** Tela inicial do motorista: registra o 1º acesso (se for o caso) e lista as convocações. */
export async function driverHome(driver: DriverPrincipal, now = new Date()) {
  return asDriver(driver.id, async (tx) => {
    await tx`select academy.register_first_access()`;
    const [me] = await tx<{ full_name: string; cpf_mask: string }[]>`select full_name, cpf_mask from drivers where id = ${driver.id}`;
    const convs = (await convocationsOfDriver(tx, driver.id, now)).filter((c) => c.status !== "cancelado");
    const convocations = await Promise.all(convs.map(async (c) => ({ ...c, videos: await driverVideosOf(tx, c.id) })));
    return { me, convocations };
  });
}
