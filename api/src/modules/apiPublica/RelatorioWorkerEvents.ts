import { prisma } from '@infra/database.js';

export async function aoFalharJobRelatorio(
  solicitacaoId: string,
  tentativasRealizadas: number,
  tentativasMaximas: number,
  erro: Error,
): Promise<void> {
  if (tentativasRealizadas < tentativasMaximas) return;

  try {
    await prisma.solicitacaoRelatorio.updateMany({
      where: { id: solicitacaoId, status: { notIn: ['CONCLUIDO', 'CANCELADO'] } },
      data: {
        status: 'FALHOU',
        erroMensagem: 'Não foi possível gerar o relatório após as tentativas configuradas.',
        concluidoEm: new Date(),
      },
    });
    console.error(JSON.stringify({ evento: 'relatorio_job_falhou', solicitacaoId, erro: erro.message }));
  } catch (erroPersistencia) {
    console.error(JSON.stringify({ evento: 'relatorio_falha_status_nao_persistida', solicitacaoId, erro: erroPersistencia }));
  }
}
