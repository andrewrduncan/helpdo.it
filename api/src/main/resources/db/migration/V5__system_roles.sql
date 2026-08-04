-- System roles are admin + trainer only. A plain end user has NO role (FAQ
-- only). Roles are part of the system — not creatable/editable/deletable via the
-- app; admins only make assignments. Drop the earlier 'user' placeholder.
DELETE FROM app_role WHERE role_key = 'user';
