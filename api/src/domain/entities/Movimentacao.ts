import { ErroValidacao } from '@/shared/errors/DomainError.js';
import { StatusRastreamento } from '@domain/enums/StatusRastreamento.js';

export type MovimentacaoPersistida = {
  id: string;
  equipamentoId: string;
  dataHora: Date;
  origem: StatusRastreamento;
  destino: StatusRastreamento;
  responsavelId: string | null;
  observacao: string | null;
  versao: number;
};
export type NovaMovimentacao = Omit<MovimentacaoPersistida, 'versao'>;

export class Movimentacao {
  private constructor(
    private readonly _id: string,
    private readonly _equipamentoId: string,
    private readonly _dataHora: Date,
    private readonly _origem: StatusRastreamento,
    private readonly _destino: StatusRastreamento,
    private readonly _responsavelId: string | null,
    private readonly _observacao: string | null,
    private readonly _versao: number
  ) {}

  static criar(dados: NovaMovimentacao): Movimentacao {
    if (!dados.id.trim() || !dados.equipamentoId.trim()) {
      throw new ErroValidacao('Identificadores são obrigatórios na movimentação.');
    }
    if (Number.isNaN(dados.dataHora.getTime()))
      throw new ErroValidacao('A data da movimentação é inválida.');
    if (dados.origem === dados.destino)
      throw new ErroValidacao('A origem e o destino da movimentação devem ser diferentes.');

    return new Movimentacao(
      dados.id,
      dados.equipamentoId,
      dados.dataHora,
      dados.origem,
      dados.destino,
      dados.responsavelId,
      dados.observacao ?? null,
      1
    );
  }

  static reconstituir(dados: MovimentacaoPersistida): Movimentacao {
    return new Movimentacao(
      dados.id,
      dados.equipamentoId,
      dados.dataHora,
      dados.origem,
      dados.destino,
      dados.responsavelId,
      dados.observacao,
      dados.versao
    );
  }

  get id(): string {
    return this._id;
  }
  get equipamentoId(): string {
    return this._equipamentoId;
  }
  get dataHora(): Date {
    return this._dataHora;
  }
  get origem(): StatusRastreamento {
    return this._origem;
  }
  get destino(): StatusRastreamento {
    return this._destino;
  }
  get responsavelId(): string | null {
    return this._responsavelId;
  }

  get observacao(): string | null {
    return this._observacao;
  }
  get versao(): number {
    return this._versao;
  }

  toPrisma(): MovimentacaoPersistida {
    return {
      id: this._id,
      equipamentoId: this._equipamentoId,
      dataHora: this._dataHora,
      origem: this._origem,
      destino: this._destino,
      responsavelId: this._responsavelId,
      observacao: this._observacao,
      versao: this._versao,
    };
  }
}
