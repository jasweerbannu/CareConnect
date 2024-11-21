from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
import base64
from io import BytesIO

# Create a PDF
buffer = BytesIO()
c = canvas.Canvas(buffer, pagesize=letter)
width, height = letter

# Add Patient and Record ID on the top-left
c.setFont("Helvetica", 10)
c.drawString(50, height - 50, "Patient ID: AP1101123G9F")
c.drawString(50, height - 70, "Record ID: RECORD006")

# Add Record Name in the center, larger font
c.setFont("Helvetica-Bold", 18)
c.drawString(width / 2 - 100, height - 150, "CT Scan Analysis")

# Add two paragraphs of dummy text
c.setFont("Helvetica", 10)
text = """The CT scan analysis offers a cross-sectional view of the
 patient’s internal organs and structures. CT scans are particularly
  useful for detecting tumors, blood clots, fractures, and infections.
   This report provides detailed imagery and analysis, often used to 
   guide further diagnosis or treatment planning."""
c.drawString(50, height - 200, text)

# Add Test Date on the top-right
c.setFont("Helvetica", 10)
c.drawString(width - 150, height - 50, "Test Date: 2023-06-01")

# Save the PDF to buffer
c.save()

# Retrieve binary data from the buffer
buffer.seek(0)
pdf_binary = buffer.read()

# To encode it to Base64
pdf_base64 = base64.b64encode(pdf_binary).decode('utf-8')

# Print the Base64 encoded data (you would insert this into your database)
print(pdf_base64)
