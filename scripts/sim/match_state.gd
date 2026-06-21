class_name MatchState
extends RefCounted

const FactionStateScript = preload("res://scripts/sim/faction_state.gd")
const CampStateScript = preload("res://scripts/sim/camp_state.gd")
const FlagStateScript = preload("res://scripts/sim/flag_state.gd")
const HippieStateScript = preload("res://scripts/sim/hippie_state.gd")
const BuildingStateScript = preload("res://scripts/sim/building_state.gd")
const SimEventScript = preload("res://scripts/sim/sim_event.gd")

var seed: String
var tick: int = 0
var factions: Dictionary = {}
var camps: Dictionary = {}
var hearth_ids: Array[String] = []
var hearth_owners: Dictionary = {}
var flags: Dictionary = {}
var hippies: Dictionary = {}
var buildings: Dictionary = {}
var jobs: Dictionary = {}
var events: Array = []
var next_ids: Dictionary = {
	"flag": 1,
	"hippie": 1,
	"building": 1,
	"job": 1,
}

func _init(match_seed: String = "") -> void:
	seed = match_seed


static func new_default(match_seed: String) -> MatchState:
	var state := MatchState.new(match_seed)
	state._setup_default_factions()
	return state


func claim_inventory_flag(faction_id: String, actor_id: String) -> String:
	if not factions.has(faction_id):
		return ""
	var faction: FactionState = factions[faction_id]
	if faction.flag_inventory <= 0:
		return ""
	faction.flag_inventory -= 1
	var flag_id := allocate_id("flag")
	var flag: FlagState = FlagStateScript.new(flag_id, faction_id)
	flag.mark_carried(actor_id, tick)
	flags[flag_id] = flag
	if not faction.carried_flag_ids.has(flag_id):
		faction.carried_flag_ids.append(flag_id)
	emit_event("flag_claimed", tick, {"faction_id": faction_id, "flag_id": flag_id, "actor_id": actor_id})
	return flag_id


func place_carried_flag(flag_id: String, target_cell: Vector2i, event_tick: int) -> bool:
	if not flags.has(flag_id):
		return false
	var flag: FlagState = flags[flag_id]
	if flag.carried_by == "":
		return false
	var previous_actor := flag.carried_by
	flag.mark_placed(target_cell, event_tick)
	_remove_carried_flag_from_all(flag_id)
	emit_event("flag_placed", event_tick, {
		"flag_id": flag_id,
		"actor_id": previous_actor,
		"cell": target_cell,
	})
	return true


func pickup_flag(flag_id: String, actor_id: String, actor_faction_id: String, event_tick: int) -> bool:
	if not flags.has(flag_id):
		return false
	var flag: FlagState = flags[flag_id]
	if flag.carried_by != "":
		return false
	flag.mark_carried(actor_id, event_tick)
	if factions.has(actor_faction_id):
		var faction: FactionState = factions[actor_faction_id]
		if not faction.carried_flag_ids.has(flag_id):
			faction.carried_flag_ids.append(flag_id)
	emit_event("flag_picked_up", event_tick, {
		"flag_id": flag_id,
		"actor_id": actor_id,
		"faction_id": actor_faction_id,
	})
	return true


func drop_flag(flag_id: String, target_cell: Vector2i, event_tick: int) -> bool:
	if not flags.has(flag_id):
		return false
	var flag: FlagState = flags[flag_id]
	if flag.carried_by == "":
		return false
	var actor_id := flag.carried_by
	flag.mark_dropped(target_cell, event_tick)
	_remove_carried_flag_from_all(flag_id)
	emit_event("flag_dropped", event_tick, {
		"flag_id": flag_id,
		"actor_id": actor_id,
		"cell": target_cell,
	})
	return true


func spend_attention(faction_id: String, amount: int) -> bool:
	if amount < 0:
		return false
	if not factions.has(faction_id):
		return false
	var faction: FactionState = factions[faction_id]
	if faction.attention_available < amount:
		return false
	faction.attention_available -= amount
	return true


func refund_attention(faction_id: String, amount: int) -> void:
	if not factions.has(faction_id):
		return
	var faction: FactionState = factions[faction_id]
	faction.attention_available = mini(faction.attention_capacity, faction.attention_available + amount)


func create_job(faction_id: String, kind: String, target_cell: Vector2i, attention: int, event_tick: int) -> String:
	var job_id := allocate_id("job")
	jobs[job_id] = {
		"id": job_id,
		"faction_id": faction_id,
		"kind": kind,
		"target_cell": target_cell,
		"attention": attention,
		"claimed_by": "",
		"status": "open",
		"created_tick": event_tick,
	}
	emit_event("job_created", event_tick, jobs[job_id])
	return job_id


func spawn_hippie(faction_id: String, start_cell: Vector2i) -> String:
	if not factions.has(faction_id):
		return ""
	var hippie_id := allocate_id("hippie")
	var hippie: HippieState = HippieStateScript.new(hippie_id, faction_id, start_cell)
	hippies[hippie_id] = hippie
	factions[faction_id].hippie_ids.append(hippie_id)
	for camp in camps.values():
		if camp.faction_id == faction_id:
			camp.hippie_ids.append(hippie_id)
			break
	emit_event("hippie_recruited", tick, {"faction_id": faction_id, "hippie_id": hippie_id})
	return hippie_id


func spawn_building(faction_id: String, kind: String, building_cell: Vector2i) -> String:
	if not factions.has(faction_id):
		return ""
	var building_id := allocate_id("building")
	var building: BuildingState = BuildingStateScript.new(building_id, faction_id, kind, building_cell)
	buildings[building_id] = building
	factions[faction_id].building_ids.append(building_id)
	for camp in camps.values():
		if camp.faction_id == faction_id:
			camp.building_ids.append(building_id)
			break
	emit_event("building_spawned", tick, {"faction_id": faction_id, "building_id": building_id, "kind": kind})
	return building_id


func capture_camp(camp_id: String, captor_faction_id: String, event_tick: int) -> void:
	if not camps.has(camp_id) or not factions.has(captor_faction_id):
		return
	var camp: CampState = camps[camp_id]
	var previous_owner := camp.faction_id
	_disable_captured_buildings(camp, previous_owner, captor_faction_id)
	_neutralize_captured_hippies(camp, previous_owner, event_tick)
	camp.faction_id = captor_faction_id
	camp.captured_tick = event_tick
	camp.disabled = true
	hearth_owners[camp.hearth_id] = captor_faction_id

	if factions.has(previous_owner):
		var previous_faction: FactionState = factions[previous_owner]
		previous_faction.camp_ids.erase(camp_id)
	if factions.has(captor_faction_id):
		var captor: FactionState = factions[captor_faction_id]
		if not captor.camp_ids.has(camp_id):
			captor.camp_ids.append(camp_id)

	_update_active_factions()
	if factions.has(previous_owner) and not factions[previous_owner].active:
		_clear_camp_capabilities(factions[previous_owner])
	emit_event("camp_captured", event_tick, {
		"camp_id": camp_id,
		"previous_owner": previous_owner,
		"captor_faction_id": captor_faction_id,
	})


func winning_faction_id() -> String:
	var active_owners := {}
	for hearth_id in hearth_ids:
		var owner: String = hearth_owners.get(hearth_id, "")
		if owner != "":
			active_owners[owner] = true
	if active_owners.size() == 1:
		return active_owners.keys()[0]
	return ""


func emit_event(event_type: String, event_tick: int, data: Dictionary = {}) -> void:
	events.append(SimEventScript.new(event_type, event_tick, data))


func allocate_id(prefix: String) -> String:
	var next_value: int = next_ids.get(prefix, 1)
	next_ids[prefix] = next_value + 1
	return "%s_%d" % [prefix, next_value]


func snapshot() -> Dictionary:
	return {
		"seed": seed,
		"tick": tick,
		"factions": _objects_to_dict(factions),
		"camps": _objects_to_dict(camps),
		"hearth_ids": hearth_ids.duplicate(),
		"hearth_owners": hearth_owners.duplicate(true),
		"flags": _objects_to_dict(flags),
		"hippies": _objects_to_dict(hippies),
		"buildings": _objects_to_dict(buildings),
		"jobs": _normalize_value(jobs),
		"next_ids": next_ids.duplicate(true),
	}


func state_hash() -> String:
	return JSON.stringify(_sort_for_hash(snapshot())).sha256_text()


func _setup_default_factions() -> void:
	var definitions: Array[Dictionary] = [
		{"id": "player", "name": "You, Vexillomancer", "player": true, "cell": Vector2i(4, 4), "color": GameConstants.TEAM_COLORS["player"]},
		{"id": "rival_surveyor", "name": "Rival Surveyor", "player": false, "cell": Vector2i(GameConstants.MAP_WIDTH - 5, 4), "color": GameConstants.TEAM_COLORS["rival_surveyor"]},
		{"id": "rival_brewer", "name": "Rival Brewer", "player": false, "cell": Vector2i(4, GameConstants.MAP_HEIGHT - 5), "color": GameConstants.TEAM_COLORS["rival_brewer"]},
		{"id": "rival_warden", "name": "Rival Warden", "player": false, "cell": Vector2i(GameConstants.MAP_WIDTH - 5, GameConstants.MAP_HEIGHT - 5), "color": GameConstants.TEAM_COLORS["rival_warden"]},
	]

	for definition in definitions:
		var faction := FactionStateScript.new(definition.id, definition.name, definition.player, definition.color)
		factions[faction.id] = faction
		var hearth_id := "hearth_%s" % faction.id
		var camp_id := "camp_%s" % faction.id
		var camp := CampStateScript.new(camp_id, faction.id, hearth_id, definition.cell)
		camps[camp_id] = camp
		faction.camp_ids.append(camp_id)
		hearth_ids.append(hearth_id)
		hearth_owners[hearth_id] = faction.id

		var hippie_id := allocate_id("hippie")
		var hippie := HippieStateScript.new(hippie_id, faction.id, definition.cell + Vector2i(1, 0))
		hippies[hippie_id] = hippie
		faction.hippie_ids.append(hippie_id)
		camp.hippie_ids.append(hippie_id)


func _update_active_factions() -> void:
	for faction_id in factions.keys():
		var has_hearth := false
		for hearth_id in hearth_ids:
			if hearth_owners.get(hearth_id, "") == faction_id:
				has_hearth = true
				break
		factions[faction_id].active = has_hearth


func _disable_captured_buildings(camp: CampState, previous_owner: String, captor_faction_id: String) -> void:
	for building_id in camp.building_ids:
		if not buildings.has(building_id):
			continue
		var building: BuildingState = buildings[building_id]
		if factions.has(previous_owner):
			factions[previous_owner].building_ids.erase(building_id)
		building.faction_id = captor_faction_id
		building.hp = 0
		building.disabled = true
		if factions.has(captor_faction_id) and not factions[captor_faction_id].building_ids.has(building_id):
			factions[captor_faction_id].building_ids.append(building_id)


func _neutralize_captured_hippies(camp: CampState, previous_owner: String, event_tick: int) -> void:
	for hippie_id in camp.hippie_ids:
		if not hippies.has(hippie_id):
			continue
		var hippie: HippieState = hippies[hippie_id]
		if factions.has(previous_owner):
			factions[previous_owner].hippie_ids.erase(hippie_id)
		hippie.faction_id = ""
		hippie.job_id = ""
		hippie.active = false
		emit_event("hippie_neutralized", event_tick, {"hippie_id": hippie_id, "camp_id": camp.id})


func _clear_camp_capabilities(faction: FactionState) -> void:
	for key in faction.camp_capabilities.keys():
		faction.camp_capabilities[key] = 0


func _remove_carried_flag_from_all(flag_id: String) -> void:
	for faction in factions.values():
		faction.carried_flag_ids.erase(flag_id)
	for hippie in hippies.values():
		if hippie.carrying_flag_id == flag_id:
			hippie.carrying_flag_id = ""


func _objects_to_dict(source: Dictionary) -> Dictionary:
	var result := {}
	for key in source.keys():
		var value: Variant = source[key]
		if value != null and value.has_method("to_dict"):
			result[key] = value.to_dict()
		else:
			result[key] = _normalize_value(value)
	return result


func _normalize_value(value: Variant) -> Variant:
	if value is Vector2i:
		return {"x": value.x, "y": value.y}
	if value is Color:
		return value.to_html(false)
	if value is Dictionary:
		var normalized := {}
		for key in value.keys():
			normalized[key] = _normalize_value(value[key])
		return normalized
	if value is Array:
		var normalized_array := []
		for entry in value:
			normalized_array.append(_normalize_value(entry))
		return normalized_array
	if value != null and value is Object:
		if value.has_method("to_dict"):
			return value.to_dict()
	return value


func _sort_for_hash(value: Variant) -> Variant:
	if value is Dictionary:
		var sorted: Dictionary = {}
		var keys: Array = value.keys()
		keys.sort()
		for key in keys:
			sorted[key] = _sort_for_hash(value[key])
		return sorted
	if value is Array:
		var array := []
		for entry in value:
			array.append(_sort_for_hash(entry))
		return array
	return value
