extends Control

@onready var client: RealtimeVoiceClient = $RealtimeVoiceClient
@onready var endpoint: LineEdit = $Panel/VBox/Endpoint
@onready var status_label: Label = $Panel/VBox/Status

var binary_packets_received := 0
var json_events_received := 0

func _ready() -> void:
	client.connection_status_changed.connect(_on_connection_status_changed)
	client.gateway_event.connect(_on_gateway_event)
	client.audio_packet_received.connect(_on_audio_packet_received)

func _on_connect_pressed() -> void:
	var error := client.connect_gateway(endpoint.text)
	if error != OK:
		status_label.text = "connect error: %s" % error

func _on_start_pressed() -> void:
	client.start_session()

func _on_probe_pressed() -> void:
	client.send_transport_probe()

func _on_stop_pressed() -> void:
	client.stop_session()

func _on_connection_status_changed(status: String) -> void:
	status_label.text = status

func _on_gateway_event(event: Dictionary) -> void:
	json_events_received += 1
	status_label.text = "json=%s binary=%s last=%s" % [
		json_events_received,
		binary_packets_received,
		str(event.get("type", "unknown")),
	]

func _on_audio_packet_received(_packet: PackedByteArray) -> void:
	binary_packets_received += 1
	status_label.text = "json=%s binary=%s" % [json_events_received, binary_packets_received]
