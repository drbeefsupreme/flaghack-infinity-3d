class_name SimulationClock
extends RefCounted

const OrderProcessorScript = preload("res://scripts/sim/order_processor.gd")

var tick_rate: int = GameConstants.MATCH_TICK_RATE
var current_tick: int = 0
var queued_orders: Array[Dictionary] = []
var processor: OrderProcessor = OrderProcessorScript.new()

func queue_order(order: Dictionary) -> void:
	queued_orders.append(order.duplicate(true))


func tick_once(state: MatchState) -> Array[Dictionary]:
	current_tick += 1
	state.tick = current_tick
	var results := processor.apply_orders_for_tick(state, queued_orders, current_tick)
	queued_orders = queued_orders.filter(func(order: Dictionary) -> bool:
		return int(order.get("tick", current_tick)) > current_tick
	)
	return results
