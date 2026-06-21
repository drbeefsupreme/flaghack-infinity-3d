class_name BuildingCatalog
extends RefCounted

var definitions: Dictionary = {}

func load_from_paths(paths: Array[String]) -> BuildingCatalog:
	definitions.clear()
	for path in paths:
		var resource: BuildingDefinition = load(path)
		definitions[resource.id] = resource.to_runtime_definition()
	return self


func get_definition(building_id: String) -> Dictionary:
	return definitions.get(building_id, {}).duplicate(true)


func place_building(state: MatchState, faction_id: String, building_id: String, cell: Vector2i) -> Dictionary:
	if not definitions.has(building_id):
		return {"ok": false, "error": "unknown_building"}
	if not state.factions.has(faction_id):
		return {"ok": false, "error": "unknown_faction"}
	var definition: Dictionary = definitions[building_id]
	var faction: FactionState = state.factions[faction_id]
	if faction.flag_inventory < int(definition.cost_flags):
		return {"ok": false, "error": "not_enough_flags"}
	if faction.attention_available < int(definition.cost_attention):
		return {"ok": false, "error": "not_enough_attention"}

	faction.flag_inventory -= int(definition.cost_flags)
	state.spend_attention(faction_id, int(definition.cost_attention))
	var runtime_id := state.spawn_building(faction_id, building_id, cell)
	var building: BuildingState = state.buildings[runtime_id]
	building.max_hp = int(definition.max_hp)
	building.hp = building.max_hp
	_apply_capability(faction, definition)
	state.emit_event("building_constructed", state.tick, {"building_id": runtime_id, "definition_id": building_id})
	return {"ok": true, "error": "", "building_id": runtime_id}


func damage_building(state: MatchState, building_id: String, amount: int) -> Dictionary:
	if not state.buildings.has(building_id):
		return {"ok": false, "error": "unknown_building"}
	var building: BuildingState = state.buildings[building_id]
	var was_disabled := building.disabled
	building.damage(amount)
	if not was_disabled and building.disabled and state.factions.has(building.faction_id):
		_remove_capability(state.factions[building.faction_id], definitions[building.kind])
	return {"ok": true, "error": ""}


func repair_building(state: MatchState, building_id: String, amount: int) -> Dictionary:
	if not state.buildings.has(building_id):
		return {"ok": false, "error": "unknown_building"}
	var building: BuildingState = state.buildings[building_id]
	var was_disabled := building.disabled
	building.repair(amount)
	if was_disabled and not building.disabled and state.factions.has(building.faction_id):
		_apply_capability(state.factions[building.faction_id], definitions[building.kind])
	return {"ok": true, "error": ""}


func _apply_capability(faction: FactionState, definition: Dictionary) -> void:
	var key: String = definition.effect_key
	faction.camp_capabilities[key] = int(faction.camp_capabilities.get(key, 0)) + int(definition.effect_amount)


func _remove_capability(faction: FactionState, definition: Dictionary) -> void:
	var key: String = definition.effect_key
	faction.camp_capabilities[key] = maxi(0, int(faction.camp_capabilities.get(key, 0)) - int(definition.effect_amount))
