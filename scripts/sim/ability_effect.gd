class_name AbilityEffect
extends Resource

@export var id: String = ""
@export var lore_name: String = ""
@export var cost_attention: int = 0
@export var cooldown_ticks: int = 0
@export var target_mode: String = "cell"
@export var effect_key: String = ""
@export var effect_amount: float = 0.0
@export var downside_key: String = ""

func to_runtime_definition() -> Dictionary:
	return {
		"id": id,
		"lore_name": lore_name,
		"cost_attention": cost_attention,
		"cooldown_ticks": cooldown_ticks,
		"target_mode": target_mode,
		"effect_key": effect_key,
		"effect_amount": effect_amount,
		"downside_key": downside_key,
	}


func apply(state: MatchState, faction_id: String, target_cell: Vector2i, event_tick: int) -> Dictionary:
	if not state.factions.has(faction_id):
		return {"ok": false, "error": "unknown_faction"}
	var faction: FactionState = state.factions[faction_id]
	if not faction.unlocked_ability_ids.has(id):
		return {"ok": false, "error": "ability_locked"}
	if target_cell.x < 0 or target_cell.y < 0:
		return {"ok": false, "error": "invalid_target"}
	if int(faction.ability_cooldowns.get(id, 0)) > event_tick:
		return {"ok": false, "error": "cooldown"}
	if not state.spend_attention(faction_id, cost_attention):
		return {"ok": false, "error": "not_enough_attention"}

	faction.ability_cooldowns[id] = event_tick + cooldown_ticks
	state.emit_event("ability_used", event_tick, {
		"faction_id": faction_id,
		"ability_id": id,
		"target_cell": target_cell,
		"effect_key": effect_key,
		"effect_amount": effect_amount,
	})
	return {"ok": true, "error": ""}
