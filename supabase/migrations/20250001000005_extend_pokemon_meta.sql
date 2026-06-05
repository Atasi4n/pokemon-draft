-- =============================================================
-- Migration 0006: Extend pokemon_meta
-- Replace single sprite_url with three separate sprite columns.
-- Add base stats (hp, attack, defense, special_attack, special_defense, speed).
-- =============================================================

ALTER TABLE pokemon_meta
  RENAME COLUMN sprite_url TO sprite_front;

ALTER TABLE pokemon_meta
  ADD COLUMN sprite_home      text,
  ADD COLUMN sprite_showdown  text,
  ADD COLUMN hp               int,
  ADD COLUMN attack           int,
  ADD COLUMN defense          int,
  ADD COLUMN special_attack   int,
  ADD COLUMN special_defense  int,
  ADD COLUMN speed            int;
