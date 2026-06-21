class_name ChakraRitual
extends RefCounted

func complete(state: MatchState, faction_id: String, ability_id: String, ritual_cost: int, event_tick: int) -> Dictionary:
	if not state.factions.has(faction_id):
		return {"ok": false, "error": "unknown_faction"}
	var faction: FactionState = state.factions[faction_id]
	if faction.ritual < ritual_cost:
		return {"ok": false, "error": "not_enough_ritual"}
	faction.ritual -= ritual_cost
	if not faction.unlocked_ability_ids.has(ability_id):
		faction.unlocked_ability_ids.append(ability_id)
	state.emit_event("chakra_aligned", event_tick, {"faction_id": faction_id, "ability_id": ability_id})
	return {"ok": true, "error": ""}


func interrupt(state: MatchState, faction_id: String, ability_id: String, event_tick: int) -> Dictionary:
	state.emit_event("chakra_interrupted", event_tick, {"faction_id": faction_id, "ability_id": ability_id})
	return {"ok": true, "error": ""}
