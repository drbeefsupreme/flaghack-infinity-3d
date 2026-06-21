class_name DrugEffect
extends Resource

@export var id: String = ""
@export var lore_name: String = ""
@export var cost_attention: int = 0
@export var duration_ticks: int = 0
@export var benefit_key: String = ""
@export var benefit_amount: float = 0.0
@export var risk_key: String = ""
@export var risk_amount: float = 0.0
@export var mutual_exclusion_group: String = ""

func to_runtime_definition() -> Dictionary:
	return {
		"id": id,
		"lore_name": lore_name,
		"cost_attention": cost_attention,
		"duration_ticks": duration_ticks,
		"benefit_key": benefit_key,
		"benefit_amount": benefit_amount,
		"risk_key": risk_key,
		"risk_amount": risk_amount,
		"mutual_exclusion_group": mutual_exclusion_group,
	}


func use_on_faction(state: MatchState, faction_id: String, event_tick: int) -> Dictionary:
	if not state.factions.has(faction_id):
		return {"ok": false, "error": "unknown_faction"}
	if not state.spend_attention(faction_id, cost_attention):
		return {"ok": false, "error": "not_enough_attention"}
	var faction: FactionState = state.factions[faction_id]
	for active in faction.active_drugs:
		if active.mutual_exclusion_group == mutual_exclusion_group and mutual_exclusion_group != "":
			return {"ok": false, "error": "mutually_exclusive"}
	var runtime := to_runtime_definition()
	runtime["expires_tick"] = event_tick + duration_ticks
	faction.active_drugs.append(runtime)
	state.emit_event("drug_used", event_tick, {"faction_id": faction_id, "drug_id": id})
	return {"ok": true, "error": "", "drug": runtime}


static func expire_drugs(state: MatchState, faction_id: String, event_tick: int) -> void:
	if not state.factions.has(faction_id):
		return
	var kept: Array[Dictionary] = []
	for active in state.factions[faction_id].active_drugs:
		if int(active.expires_tick) > event_tick:
			kept.append(active)
	state.factions[faction_id].active_drugs = kept
