-- Correct the display name only. Keep division IDs, codes, SKU prefixes and history.
UPDATE "Division"
SET "name" = 'LEGAYEBI'
WHERE "code" = 'LE_GAYE_BI' AND "name" = 'Le Gaye Bi Group';
