# Media ownership and legacy recovery

Unfiled uploads now use `media-owners/<encoded-user-id>/media/<filename>` or
`media-owners/<encoded-user-id>/music/<filename>`. Direct upload signing, server
uploads, staged upload commits, and moves to Unfiled all produce these keys.
Listing, renaming, moving, deleting, and batch music selection enforce the
authenticated owner's prefix. Project folder keys continue to use the owner
recorded in their `.project.json` manifest.

Older `media/<filename>` and `music/<filename>` keys do not identify an owner.
They are hidden from library and batch music selection, and denied for mutation,
unless `RELAY_LEGACY_MEDIA_OWNER_ID` is explicitly set to the owning user's exact
database ID. The setting applies to **all** legacy root files in the bucket.
Relay does not infer an owner from the current account count or registration
order: deleted accounts and reused buckets make those assumptions unsafe.

For a bucket known to contain one person's legacy files, an operator can verify
that person's ID in the `user` database table, set
`RELAY_LEGACY_MEDIA_OWNER_ID=<verified-user-id>` in the web application's
environment, and restart it. That account can then see the files in All and
Unfiled and use the normal library actions. Renaming a legacy file or moving it
to Unfiled copies it into the owner's prefix, updates that owner's saved media
references, and removes the original only after those updates succeed. Moving
it to an owned project assigns that project's ownership instead. Once no legacy
root files remain, remove the recovery setting.

If legacy files belong to several people, leave the setting unset. Inventory
the objects and establish ownership from reliable records first. Plan a manual
per-file migration into each verified owner's prefix or project, including
updating saved URL references and a backup before removing original objects.
Never assign one recovery owner to a mixed bucket. This change performs no
automatic cloud migration, copy, or deletion on deployment.

The R2 public domain remains publicly reachable for publishing and playback.
Library ownership controls protect discovery and management through Relay;
existing public URLs retain their public access behavior until moved or removed.
