from backend.international import parse_cires_detail, parse_jma_eew_xml, parse_jma_quake_item


def test_cires_public_bulletin_parser():
    html = """
    <html><body>
      <h2>Boletín del Sistema de Alerta Sísmica Mexicano (SASMEX)</h2>
      <p>El SASMEX detectó un sismo inicialmente en 30 estaciones sismo sensoras,
      que generó un aviso de Alerta Sísmica a la Ciudad de México.</p>
      <table>
        <tr><td>Fecha GMT</td><td>08/02/2026</td></tr>
        <tr><td>Hora GMT</td><td>21:42:11</td></tr>
        <tr><td>Mag Inicial Preliminar</td><td>5.7</td></tr>
        <tr><td>Latitud</td><td>15.90</td></tr>
        <tr><td>Longitud</td><td>-96.94</td></tr>
        <tr><td>Profundidad (Km)</td><td>17.00</td></tr>
      </table>
    </body></html>
    """
    event = parse_cires_detail(html, "https://www.cires.org.mx/test")
    assert event is not None
    assert event["source"] == "CIRES / SASMEX"
    assert event["eewEligible"] is True
    assert event["waveEligible"] is True
    assert event["stationCount"] == 30
    assert event["magnitude"] == 5.7
    assert event["lat"] == 15.90
    assert event["lon"] == -96.94
    assert event["depthKm"] == 17.0


def test_jma_public_quake_is_not_mislabeled_as_eew():
    item = {
        "at": "2026-08-29T20:10:00+09:00",
        "anm": "千葉県東方沖",
        "mag": "4.2",
        "maxi": "3",
        "cod": "+35.4+140.5-30000/",
    }
    event = parse_jma_quake_item(item)
    assert event is not None
    assert event["source"] == "JMA"
    assert event["eewEligible"] is False
    assert event["waveEligible"] is False
    assert event["magnitude"] == 4.2
    assert event["depthKm"] == 30.0
    assert event["maxIntensity"] == "3"


def test_authorized_jma_eew_xml_enables_wavefronts():
    xml = """
    <Report xmlns:jmx_eb="http://xml.kishou.go.jp/jmaxml1/elementBasis1/">
      <Head><EventID>202608290001</EventID><Serial>2</Serial></Head>
      <Body><Earthquake>
        <OriginTime>2026-08-29T20:10:00+09:00</OriginTime>
        <Hypocenter><Area><Name>千葉県東方沖</Name>
          <jmx_eb:Coordinate>+35.4+140.5-30000/</jmx_eb:Coordinate>
        </Area></Hypocenter>
        <jmx_eb:Magnitude>5.1</jmx_eb:Magnitude>
      </Earthquake></Body>
    </Report>
    """
    event = parse_jma_eew_xml(xml, "https://authorized.example/jma.xml")
    assert event is not None
    assert event["source"] == "JMA EEW"
    assert event["eewEligible"] is True
    assert event["waveEligible"] is True
    assert event["magnitude"] == 5.1
    assert event["depthKm"] == 30.0
