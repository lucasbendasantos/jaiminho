'use strict';
// Serviço SOAP de viajantes (1.1 e 1.2) com WSDL e XSD.
const NS = 'http://jaiminho.local/mock/traveller';

function xsd() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<xs:schema xmlns:xs="http://www.w3.org/2001/XMLSchema" targetNamespace="${NS}" xmlns:tns="${NS}" elementFormDefault="qualified">
  <xs:element name="GetTravellerRequest">
    <xs:complexType><xs:sequence><xs:element name="id" type="xs:string"/></xs:sequence></xs:complexType>
  </xs:element>
  <xs:element name="GetTravellerResponse">
    <xs:complexType><xs:sequence><xs:element name="traveller" type="tns:Traveller"/></xs:sequence></xs:complexType>
  </xs:element>
  <xs:element name="CreateTravellerRequest">
    <xs:complexType><xs:sequence><xs:element name="traveller" type="tns:Traveller"/></xs:sequence></xs:complexType>
  </xs:element>
  <xs:element name="CreateTravellerResponse">
    <xs:complexType><xs:sequence><xs:element name="id" type="xs:string"/></xs:sequence></xs:complexType>
  </xs:element>
  <xs:complexType name="Traveller">
    <xs:sequence>
      <xs:element name="id" type="xs:string" minOccurs="0"/>
      <xs:element name="firstName" type="xs:string"/>
      <xs:element name="lastName" type="xs:string"/>
      <xs:element name="nationality" minOccurs="0">
        <xs:simpleType><xs:restriction base="xs:string"><xs:enumeration value="MX"/><xs:enumeration value="PT"/><xs:enumeration value="BR"/></xs:restriction></xs:simpleType>
      </xs:element>
      <xs:element name="birthDate" type="xs:date" minOccurs="0"/>
    </xs:sequence>
  </xs:complexType>
</xs:schema>`;
}

function wsdl(base) {
  const schemaBody = xsd().replace(/^<\?xml[^>]*>\s*/, '');
  return `<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/" xmlns:soap12="http://schemas.xmlsoap.org/wsdl/soap12/"
  xmlns:tns="${NS}" targetNamespace="${NS}" name="TravellerService">
  <wsdl:types>
    ${schemaBody}
  </wsdl:types>
  <wsdl:message name="GetTravellerIn"><wsdl:part name="parameters" element="tns:GetTravellerRequest"/></wsdl:message>
  <wsdl:message name="GetTravellerOut"><wsdl:part name="parameters" element="tns:GetTravellerResponse"/></wsdl:message>
  <wsdl:message name="CreateTravellerIn"><wsdl:part name="parameters" element="tns:CreateTravellerRequest"/></wsdl:message>
  <wsdl:message name="CreateTravellerOut"><wsdl:part name="parameters" element="tns:CreateTravellerResponse"/></wsdl:message>
  <wsdl:portType name="TravellerPort">
    <wsdl:operation name="GetTraveller"><wsdl:input message="tns:GetTravellerIn"/><wsdl:output message="tns:GetTravellerOut"/></wsdl:operation>
    <wsdl:operation name="CreateTraveller"><wsdl:input message="tns:CreateTravellerIn"/><wsdl:output message="tns:CreateTravellerOut"/></wsdl:operation>
  </wsdl:portType>
  <wsdl:binding name="TravellerSoap11" type="tns:TravellerPort">
    <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="GetTraveller"><soap:operation soapAction="${NS}/GetTraveller"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="CreateTraveller"><soap:operation soapAction="${NS}/CreateTraveller"/><wsdl:input><soap:body use="literal"/></wsdl:input><wsdl:output><soap:body use="literal"/></wsdl:output></wsdl:operation>
  </wsdl:binding>
  <wsdl:binding name="TravellerSoap12" type="tns:TravellerPort">
    <soap12:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="GetTraveller"><soap12:operation soapAction="${NS}/GetTraveller"/><wsdl:input><soap12:body use="literal"/></wsdl:input><wsdl:output><soap12:body use="literal"/></wsdl:output></wsdl:operation>
    <wsdl:operation name="CreateTraveller"><soap12:operation soapAction="${NS}/CreateTraveller"/><wsdl:input><soap12:body use="literal"/></wsdl:input><wsdl:output><soap12:body use="literal"/></wsdl:output></wsdl:operation>
  </wsdl:binding>
  <wsdl:service name="TravellerService">
    <wsdl:port name="TravellerSoap11Port" binding="tns:TravellerSoap11"><soap:address location="${base}/soap/TravellerService"/></wsdl:port>
    <wsdl:port name="TravellerSoap12Port" binding="tns:TravellerSoap12"><soap12:address location="${base}/soap/TravellerService"/></wsdl:port>
  </wsdl:service>
</wsdl:definitions>`;
}

function envelope(v12, body) {
  const ns = v12 ? 'http://www.w3.org/2003/05/soap-envelope' : 'http://schemas.xmlsoap.org/soap/envelope/';
  return `<?xml version="1.0" encoding="UTF-8"?>\n<soap:Envelope xmlns:soap="${ns}" xmlns:tns="${NS}"><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

function fault(v12, code, msg) {
  return v12
    ? `<soap:Fault><soap:Code><soap:Value>soap:${code === 'Client' ? 'Sender' : 'Receiver'}</soap:Value></soap:Code><soap:Reason><soap:Text xml:lang="pt">${msg}</soap:Text></soap:Reason></soap:Fault>`
    : `<soap:Fault><faultcode>soap:${code}</faultcode><faultstring>${msg}</faultstring></soap:Fault>`;
}

const tag = (xml, name) => { const m = new RegExp(`<(?:\\w+:)?${name}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${name}>`).exec(xml); return m ? m[1].trim() : undefined; };

function handle(xml, headers, db) {
  const ct = headers['content-type'] || '';
  const v12 = /application\/soap\+xml/i.test(ct) || xml.includes('http://www.w3.org/2003/05/soap-envelope');
  const contentType = v12 ? 'application/soap+xml; charset=utf-8' : 'text/xml; charset=utf-8';
  if (!/<(?:\w+:)?Envelope/.test(xml)) return { status: 400, contentType, body: envelope(v12, fault(v12, 'Client', 'Envelope SOAP ausente')) };
  const action = (headers.soapaction || (/action="([^"]+)"/.exec(ct) || [])[1] || '').replace(/"/g, '');
  if (!v12 && !headers.soapaction) return { status: 500, contentType, body: envelope(v12, fault(v12, 'Client', 'Header SOAPAction obrigatório em SOAP 1.1')) };
  if (/GetTravellerRequest/.test(xml) || action.endsWith('/GetTraveller')) {
    const id = tag(xml, 'id');
    const t = db.get(id);
    if (!t) return { status: 500, contentType, body: envelope(v12, fault(v12, 'Client', `Viajante ${id} não encontrado`)) };
    return { status: 200, contentType, body: envelope(v12, `<tns:GetTravellerResponse><tns:traveller><tns:id>${t.id}</tns:id><tns:firstName>${t.firstName}</tns:firstName><tns:lastName>${t.lastName}</tns:lastName><tns:nationality>${t.nationality}</tns:nationality></tns:traveller></tns:GetTravellerResponse>`) };
  }
  if (/CreateTravellerRequest/.test(xml) || action.endsWith('/CreateTraveller')) {
    const firstName = tag(xml, 'firstName'); const lastName = tag(xml, 'lastName');
    if (!firstName || !lastName) return { status: 500, contentType, body: envelope(v12, fault(v12, 'Client', 'firstName e lastName são obrigatórios')) };
    const id = String(1000 + db.size);
    db.set(id, { id, firstName, lastName, nationality: tag(xml, 'nationality') || 'PT' });
    return { status: 200, contentType, body: envelope(v12, `<tns:CreateTravellerResponse><tns:id>${id}</tns:id></tns:CreateTravellerResponse>`) };
  }
  return { status: 500, contentType, body: envelope(v12, fault(v12, 'Client', 'Operação desconhecida')) };
}

module.exports = { wsdl, xsd, handle, NS };
