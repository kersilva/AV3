-- O fluxo operacional mantém o limite de 90 dias. O seed define um modo de
-- sessão local à transação para criar coortes históricas de análise.
CREATE OR REPLACE FUNCTION lote_valida_data_entrada() RETURNS trigger AS $$
BEGIN
  IF current_setting('greencode.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW."dataEntrada" > now() THEN
    RAISE EXCEPTION 'A data de entrada do lote não pode ser futura.';
  END IF;
  IF NEW."dataEntrada" < now() - interval '90 days' THEN
    RAISE EXCEPTION 'A data de entrada do lote não pode ser anterior a 90 dias.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
