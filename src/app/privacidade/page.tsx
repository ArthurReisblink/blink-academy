import { Logo } from "@/components/ui/misc";

export const metadata = { title: "Aviso de privacidade" };

export default function Page() {
  return (
    <main className="prose-sm mx-auto max-w-2xl px-5 py-10 text-slate-700">
      <Logo className="h-12" />
      <h1 className="mt-6 text-2xl font-extrabold text-slate-900">Aviso de privacidade — BLINK Academy</h1>
      <p className="mt-2 text-xs text-slate-500">Modelo inicial. Deve ser revisado e aprovado pela área jurídica / encarregado (DPO) da BLINK antes do uso oficial.</p>
      <section className="mt-6 space-y-4 text-sm leading-relaxed">
        <p><strong>Quem trata os dados.</strong> BLINK Logística Inteligente Ltda. (CNPJ 46.380.603/0001-67), como controladora.</p>
        <p><strong>Quais dados.</strong> Nome, CPF, telefone, e-mail, base operacional, referência da ocorrência PNR, registros de acesso (data, hora, IP e navegador), progresso dos vídeos, respostas e notas das avaliações, e registros de aceite eletrônico do termo.</p>
        <p><strong>Para quê.</strong> Identificar o motorista com segurança, aplicar e comprovar o treinamento obrigatório sobre Prova de Entrega (POD) e PNR, e manter evidências da conclusão.</p>
        <p><strong>Base legal.</strong> Execução de contrato e procedimentos preliminares, cumprimento de obrigação legal ou regulatória e exercício regular de direitos (art. 7º da LGPD), conforme definido pelo jurídico da BLINK.</p>
        <p><strong>Segurança.</strong> Acesso protegido por código temporário, conexão criptografada (HTTPS), CPF armazenado de forma cifrada, controle de acesso por perfil e registro de ações administrativas.</p>
        <p><strong>Por quanto tempo.</strong> Pelo período necessário às finalidades acima e aos prazos legais aplicáveis, conforme a política de retenção configurada pela BLINK.</p>
        <p><strong>Seus direitos.</strong> Você pode pedir confirmação, acesso, correção, anonimização ou eliminação dos seus dados, nos limites da lei, pelo canal de atendimento da BLINK.</p>
      </section>
    </main>
  );
}
