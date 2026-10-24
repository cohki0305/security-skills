#!/bin/bash
. "$(dirname "$0")/_common.sh"
# fdesetup status works without admin rights. "On." = protected; "Off." and in-progress states = not protected yet.
sc_capture fdesetup status
if [ "$CAP_RC" -ne 0 ]; then
  sc_emit '{}' "$(sc_unavailable_for_capture)"
  exit 0
fi
first=$(printf '%s\n' "$CAP_OUT" | head -n 1)
case "$first" in
  "FileVault is On."*) sc_emit '{"encrypted":true}' "" ;;
  "FileVault is Off."*) sc_emit '{"encrypted":false}' "" ;;
  *)
    case "$CAP_OUT" in
      *"Encryption in progress"*|*"Decryption in progress"*) sc_emit '{"encrypted":false}' "" ;;
      *) sc_emit '{"encrypted":null}' "not_supported" ;;
    esac ;;
esac
exit 0
