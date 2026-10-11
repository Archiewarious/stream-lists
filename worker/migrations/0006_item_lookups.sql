-- Lookups every item insert makes (src/index.ts, insertItem): is the title or the Pointauc lot already in the list,
-- and the next place in its queue. Without them each check reads the whole list.
CREATE INDEX items_list_title ON items (list_id, title);
CREATE INDEX items_list_lot ON items (list_id, lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX items_list_queue ON items (list_id, status, position);
