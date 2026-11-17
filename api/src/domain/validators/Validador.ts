export abstract class Validador<T> {
  abstract validar(valor: T): boolean;

  obterMensagemErro(): string {
    return 'Valor inválido.';
  }
}