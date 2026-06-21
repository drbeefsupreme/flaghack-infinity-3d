class_name OrderProcessor
extends RefCounted

const RaidOrderScript = preload("res://scripts/sim/raid_order.gd")

func apply_orders_for_tick(state: MatchState, orders: Array[Dictionary], tick: int) -> Array[Dictionary]:
	var scoped_orders: Array[Dictionary] = []
	for order in orders:
		if int(order.get("tick", tick)) == tick:
			scoped_orders.append(order)
	scoped_orders.sort_custom(_compare_orders)

	var results: Array[Dictionary] = []
	for order in scoped_orders:
		results.append(apply_order(state, order))
	return results


func apply_order(state: MatchState, order: Dictionary) -> Dictionary:
	var validation := validate_order(state, order)
	if not validation.ok:
		return validation

	var order_type: String = order.get("type", "")
	var payload: Dictionary = order.get("payload", {})
	var tick: int = int(order.get("tick", state.tick))
	var faction_id: String = order.get("faction_id", "")
	var actor_id: String = order.get("actor_id", "")

	match order_type:
		"place_flag":
			state.place_carried_flag(payload.flag_id, payload.cell, tick)
			return _ok(order)
		"pickup_flag":
			state.pickup_flag(payload.flag_id, actor_id, faction_id, tick)
			return _ok(order)
		"drop_flag":
			state.drop_flag(payload.flag_id, payload.cell, tick)
			return _ok(order)
		"assign_survey_work":
			state.spend_attention(faction_id, int(payload.attention))
			state.create_job(faction_id, "survey", payload.target_cell, int(payload.attention), tick)
			return _ok(order)
		"raid_building":
			var raid_result: Dictionary = RaidOrderScript.new().apply(state, faction_id, payload.target_building_id, int(payload.attention), tick)
			if raid_result.ok:
				return _ok(order)
			return _err(raid_result.error)
		_:
			return _err("unknown_order_type")


func validate_order(state: MatchState, order: Dictionary) -> Dictionary:
	var order_type: String = order.get("type", "")
	var faction_id: String = order.get("faction_id", "")
	var payload: Dictionary = order.get("payload", {})

	if faction_id == "" or not state.factions.has(faction_id):
		return _err("unknown_faction")
	if not state.factions[faction_id].active:
		return _err("inactive_faction")

	match order_type:
		"place_flag":
			if not payload.has("flag_id"):
				return _err("missing_flag_id")
			if not state.flags.has(payload.flag_id):
				return _err("unknown_flag")
			if state.flags[payload.flag_id].carried_by == "":
				return _err("flag_not_carried")
			if state.flags[payload.flag_id].carried_by != order.get("actor_id", ""):
				return _err("actor_not_carrying_flag")
			if not payload.has("cell"):
				return _err("missing_cell")
		"pickup_flag":
			if not payload.has("flag_id"):
				return _err("missing_flag_id")
			if not state.flags.has(payload.flag_id):
				return _err("unknown_flag")
			if state.flags[payload.flag_id].carried_by != "":
				return _err("flag_already_carried")
		"drop_flag":
			if not payload.has("flag_id"):
				return _err("missing_flag_id")
			if not state.flags.has(payload.flag_id):
				return _err("unknown_flag")
			if state.flags[payload.flag_id].carried_by == "":
				return _err("flag_not_carried")
			if state.flags[payload.flag_id].carried_by != order.get("actor_id", ""):
				return _err("actor_not_carrying_flag")
			if not payload.has("cell"):
				return _err("missing_cell")
		"assign_survey_work":
			var attention: int = int(payload.get("attention", 0))
			if attention <= 0:
				return _err("invalid_attention")
			if state.factions[faction_id].attention_available < attention:
				return _err("not_enough_attention")
			if not payload.has("target_cell"):
				return _err("missing_target_cell")
		"raid_building":
			var attention: int = int(payload.get("attention", 0))
			if attention <= 0:
				return _err("invalid_attention")
			if state.factions[faction_id].attention_available < attention:
				return _err("not_enough_attention")
			if not payload.has("target_building_id"):
				return _err("missing_target_building")
			if not state.buildings.has(payload.target_building_id):
				return _err("unknown_building")
			if state.buildings[payload.target_building_id].faction_id == faction_id:
				return _err("cannot_raid_own_building")
		_:
			return _err("unknown_order_type")

	return _ok(order)


func _compare_orders(a: Dictionary, b: Dictionary) -> bool:
	var a_key := _order_key(a)
	var b_key := _order_key(b)
	for index in range(a_key.size()):
		if a_key[index] == b_key[index]:
			continue
		return a_key[index] < b_key[index]
	return false


func _order_key(order: Dictionary) -> Array:
	return [
		int(order.get("tick", 0)),
		String(order.get("faction_id", "")),
		String(order.get("actor_id", "")),
		String(order.get("id", "")),
	]


func _ok(order: Dictionary) -> Dictionary:
	return {
		"ok": true,
		"order_id": order.get("id", ""),
		"error": "",
	}


func _err(error: String) -> Dictionary:
	return {
		"ok": false,
		"order_id": "",
		"error": error,
	}
