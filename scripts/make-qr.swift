import Foundation
import CoreImage
import AppKit
import Vision

guard CommandLine.arguments.count == 3 else { fatalError("Usage: make-qr.swift URL output.png") }
let value = CommandLine.arguments[1]
let filter = CIFilter(name: "CIQRCodeGenerator")!
filter.setValue(Data(value.utf8), forKey: "inputMessage")
filter.setValue("M", forKey: "inputCorrectionLevel")
let original = filter.outputImage!
let scale: CGFloat = 12
let quiet: CGFloat = 48
let qr = original.transformed(by: CGAffineTransform(scaleX: scale, y: scale)).transformed(by: CGAffineTransform(translationX: quiet, y: quiet))
let size = original.extent.width * scale + quiet * 2
let extent = CGRect(x: 0, y: 0, width: size, height: size)
let white = CIImage(color: CIColor(red: 1, green: 1, blue: 1)).cropped(to: extent)
let complete = qr.composited(over: white)
let image = CIContext().createCGImage(complete, from: extent)!
let bitmap = NSBitmapImageRep(cgImage: image)
try bitmap.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: CommandLine.arguments[2]))
let request = VNDetectBarcodesRequest()
try VNImageRequestHandler(cgImage: image).perform([request])
guard request.results?.contains(where: { $0.payloadStringValue == value }) == true else { fatalError("Generated QR code did not verify") }
print("QR verified: \(value)")
