class_name PlannerView
extends RefCounted

func from_state(state: MatchState, faction_id: String) -> Dictionary:
	if not state.factions.has(faction_id):
		return {}
	var faction: FactionState = state.factions[faction_id]
	var own_camps: Array[Dictionary] = []
	for camp_id in faction.camp_ids:
		if state.camps.has(camp_id):
			own_camps.append(state.camps[camp_id].to_dict())

	var visible_buildings: Array[Dictionary] = []
	for building in state.buildings.values():
		if building.faction_id != faction_id:
			visible_buildings.append(building.to_dict())

	var open_jobs: Array[Dictionary] = []
	for job in state.jobs.values():
		if job.faction_id == faction_id and job.status in ["open", "blocked_no_flag"]:
			open_jobs.append(job.duplicate(true))

	return {
		"faction_id": faction_id,
		"active": faction.active,
		"attention_available": faction.attention_available,
		"flag_inventory": faction.flag_inventory,
		"own_camps": own_camps,
		"visible_buildings": visible_buildings,
		"open_jobs": open_jobs,
		"unlocked_ability_ids": faction.unlocked_ability_ids.duplicate(),
		"camp_capabilities": faction.camp_capabilities.duplicate(true),
	}
