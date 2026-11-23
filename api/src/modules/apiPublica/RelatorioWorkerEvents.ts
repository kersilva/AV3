import { prisma } from '@infra/database.js';

export async function aoFalharJobRelatorio(
  solicitacaoId: string,
  tentativasRealizadas: number,
  tentativasMaximas: number,
  erro: Error,
): Promise<void> {
  if (tentativasRealizadas < tentativasMaximas) return;

  try {
    const resultado = await prisma.solicitacaoRelatorio.updateMany({
      where: {
        id: solicitacaoId,
        status: { notIn: ['CONCLUIDO', 'CANCELADO'] },
        leaseToken: null,
      },
      data: {
        status: 'FALHOU',
        erroMensagem: 'Não foi possível gerar o relatório após as tentativas configuradas.',
        concluidoEm: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    if (resultado.count === 1) {
      console.error(JSON.stringify({ evento: 'relatorio_job_falhou', solicitacaoId, erro: erro.message }));
    }
  } catch (erroPersistencia) {
    console.error(JSON.stringify({ evento: 'relatorio_falha_status_nao_persistida', solicitacaoId, erro: erroPersistencia }));
  }
}
