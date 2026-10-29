import { requireAdmin } from "@/server/web";
import { listVideos } from "@/server/services/videos";
import { fmtDateTime } from "@/lib/time";
import { Alert, Badge, Card, CardBody, CardTitle, EmptyState, PageHeader } from "@/components/ui/misc";
import { VideoUploader } from "./uploader";
import { VideoEdit, VideoPreview } from "./video-row";

export const metadata = { title: "Biblioteca de vídeos" };

const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export default async function Page() {
  const admin = await requireAdmin();
  const videos = await listVideos(admin);
  const canWrite = admin.role !== "auditor";
  return (
    <>
      <PageHeader title="Biblioteca de vídeos" description="Arquivos privados: o motorista só assiste por links temporários, dentro do prazo da convocação." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-3">
          {videos.length === 0 ? <EmptyState title="Nenhum vídeo enviado">Envie o primeiro MP4 ao lado.</EmptyState> : videos.map((v) => (
            <Card key={v.id}><CardBody className="space-y-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><p className="font-bold">{v.title}</p>
                  <p className="text-xs text-slate-500">{mmss(Number(v.duration_seconds))} · {mb(Number(v.size_bytes))} · enviado em {fmtDateTime(v.created_at)}</p>
                  {v.description ? <p className="mt-1 text-sm text-slate-600">{v.description}</p> : null}</div>
                <div className="flex gap-2">{v.status === "ready" ? <Badge tone="ok">Disponível</Badge> : <Badge tone="warn">Envio não concluído</Badge>}
                  <Badge tone="brand">Em {v.used_in} versão(ões)</Badge></div>
              </div>
              <div className="flex flex-wrap items-start gap-4">
                {v.status === "ready" ? <VideoPreview id={v.id} /> : null}
                {canWrite ? <VideoEdit id={v.id} title={v.title} description={v.description} canDelete={v.used_in === 0} /> : null}
              </div>
            </CardBody></Card>
          ))}
        </div>
        <div className="space-y-4">
          {canWrite ? <Card><CardBody><CardTitle>Enviar vídeo</CardTitle><div className="mt-4"><VideoUploader /></div></CardBody></Card> : null}
          <Alert tone="slate" title="Sobre o controle de reprodução">
            O sistema registra os trechos efetivamente reproduzidos e limita o crédito ao tempo real decorrido. Mesmo assim, eventos do player não garantem a atenção do motorista diante da tela — por isso a avaliação e o termo complementam a comprovação.
          </Alert>
        </div>
      </div>
    </>
  );
}
