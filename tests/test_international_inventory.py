from backend.international_inventory import parse_fdsn_station_text, parse_jma_station_html


def test_parse_jma_station_html_returns_level_zero_real_coordinates():
    html = """
    <table>
      <tr><th>code</th><th>Station name</th><th>lat d</th><th>lat m</th><th>lon d</th><th>lon m</th></tr>
      <tr><td>JTOKYO</td><td>Tokyo</td><td>35</td><td>41.40</td><td>139</td><td>45.30</td><td>18</td></tr>
      <tr><td>JSAPPO</td><td>Sapporo</td><td>43</td><td>03.60</td><td>141</td><td>19.70</td><td>18</td></tr>
    </table>
    """
    stations = parse_jma_station_html(html)
    assert len(stations) == 2
    tokyo = stations[0]
    assert tokyo["key"] == "JMA.JTOKYO"
    assert abs(tokyo["lat"] - 35.69) < 0.001
    assert abs(tokyo["lon"] - 139.755) < 0.001
    assert tokyo["level"] == 0
    assert tokyo["live"] is False


def test_parse_mexico_fdsn_station_text_keeps_real_station_metadata_at_zero():
    text = """#Network|Station|Latitude|Longitude|Elevation|SiteName|StartTime|EndTime
AM|R1234|19.4326|-99.1332|2240|Ciudad de Mexico|2024-01-01T00:00:00|
AM|R5678|16.8531|-99.8237|10|Acapulco|2024-01-01T00:00:00|
"""
    stations = parse_fdsn_station_text(text, source_label="Raspberry Shake public inventory")
    assert len(stations) == 2
    assert stations[0]["key"] == "AM.R1234"
    assert stations[0]["lat"] == 19.4326
    assert stations[0]["lon"] == -99.1332
    assert stations[0]["level"] == 0
    assert stations[0]["activityLevel"] == 0
    assert stations[0]["live"] is False
