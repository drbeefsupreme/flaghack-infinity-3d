class_name RaidOrder
extends RefCounted

func apply(state: MatchState, faction_id: String, target_building_id: String, attention: int, event_tick: int) -> Dictionary:
	if not state.factions.has(faction_id):
		return {"ok": false, "error": "unknown_faction"}
	if not state.buildings.has(target_building_id):
		return {"ok": false, "error": "unknown_building"}
	if state.buildings[target_building_id].disabled:
		return {"ok": false, "error": "building_disabled"}
	if not state.spend_attention(faction_id, attention):
		return {"ok": false, "error": "not_enough_attention"}

	var building: BuildingState = state.buildings[target_building_id]
	var was_disabled := building.disabled
	building.damage(maxi(1, attention * 2))
	if not was_disabled and building.disabled:
		state.remove_building_capability(target_building_id)
	state.emit_event("building_raided", event_tick, {
		"faction_id": faction_id,
		"building_id": target_building_id,
		"damage": attention * 2,
	})
	return {"ok": true, "error": ""}
