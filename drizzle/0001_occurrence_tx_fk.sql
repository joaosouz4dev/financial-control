-- recurrence_occurrences.transaction_id -> transactions.id
-- Declarada aqui porque as duas tabelas se referenciam mutuamente e o Drizzle
-- nao consegue expressar o ciclo na definicao.
ALTER TABLE "recurrence_occurrences"
  ADD CONSTRAINT "recurrence_occurrences_transaction_id_fk"
  FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE SET NULL;
