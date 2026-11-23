-- Mantenha a proteção contra datas futuras até no seed; somente o limite
-- histórico de 90 dias é flexibilizado na transação local do seed.
CREATE OR REPLACE FUNCTION lote_valida_data_entrada() RETURNS trigger AS $$
BEGIN
  IF NEW."dataEntrada" > now() THEN
    RAISE EXCEPTION 'A data de entrada do lote não pode ser futura.';
  END IF;

  IF current_setting('greencode.seed_mode', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF NEW."dataEntrada" < now() - interval '90 days' THEN
    RAISE EXCEPTION 'A data de entrada do lote não pode ser anterior a 90 dias.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
